import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import type { ProcessObservation } from "../Domain.ts"

/** Bounded child-process launch specification. */
export interface ProcessSpec {
  readonly command: string
  readonly args?: ReadonlyArray<string>
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly timeoutMillis: number
  readonly terminationGraceMillis?: number
  /** Maximum UTF-8 bytes retained in memory after both output streams are drained. */
  readonly retainedOutputBytes?: number
  /** Maximum number of output lines retained in memory. */
  readonly retainedOutputLines?: number
}

/** Exit code and bounded observations returned by a completed process. */
export interface ProcessResult {
  readonly exitCode: number
  readonly observations: ReadonlyArray<ProcessObservation>
}

/** Failure raised when a child process cannot be spawned, drained, or terminated. */
export class ProcessFailure extends Data.TaggedError("ProcessFailure")<{
  readonly reason: "spawn" | "stream" | "exit" | "timeout"
  readonly spec: ProcessSpec
  readonly observations: ReadonlyArray<ProcessObservation>
  readonly cause: unknown
}> {}

/** Backend process handle exposed to the supervisor lifecycle. */
export interface ProcessHandle {
  readonly stdout: Stream.Stream<string, unknown>
  readonly stderr: Stream.Stream<string, unknown>
  readonly exitCode: Effect.Effect<number, unknown>
  readonly terminate: (graceMillis: number) => Effect.Effect<void, unknown>
}

/** Minimal process backend used by the real and test supervisors. */
export interface ProcessBackend {
  readonly spawn: (spec: ProcessSpec) => Effect.Effect<ProcessHandle, unknown, Scope.Scope>
}

/** Running process with shared completion, observations, and termination effects. */
export interface RunningProcess {
  readonly exitCode: Effect.Effect<number, ProcessFailure>
  readonly observations: Effect.Effect<ReadonlyArray<ProcessObservation>>
  readonly terminate: Effect.Effect<void, ProcessFailure>
}

/** Process lifecycle operations with bounded output and timeout handling. */
export interface Service {
  readonly start: (spec: ProcessSpec) => Effect.Effect<RunningProcess, ProcessFailure, Scope.Scope>
  readonly run: (spec: ProcessSpec) => Effect.Effect<ProcessResult, ProcessFailure>
}

/** Effect context tag for supervised child processes. */
export class ProcessSupervisor extends Context.Service<ProcessSupervisor, Service>()(
  "@better-native/compatibility-harness/ProcessSupervisor",
) {}

const defaultRetainedOutputBytes = 4 * 1024 * 1024
const defaultRetainedOutputLines = 10_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface ObservationBuffer {
  readonly entries: ReadonlyArray<{
    readonly observation: ProcessObservation
    readonly bytes: number
  }>
  readonly retainedBytes: number
  readonly omittedLines: number
  readonly omittedBytes: number
}

const emptyBuffer: ObservationBuffer = {
  entries: [],
  retainedBytes: 0,
  omittedLines: 0,
  omittedBytes: 0,
}

const positiveLimit = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback

const retain = (
  state: ObservationBuffer,
  observation: ProcessObservation,
  byteLimit: number,
  lineLimit: number,
  preOmittedBytes = 0,
  preOmittedLines = 0,
): ObservationBuffer => {
  const encoded = encoder.encode(observation.text)
  const bytes = Math.min(encoded.byteLength, byteLimit)
  const next = {
    observation:
      encoded.byteLength <= byteLimit
        ? observation
        : { ...observation, text: decoder.decode(encoded.slice(encoded.byteLength - byteLimit)) },
    bytes,
  }
  const entries = [...state.entries, next]
  let retainedBytes = state.retainedBytes + bytes
  let omittedLines = state.omittedLines + preOmittedLines + (encoded.byteLength > byteLimit ? 1 : 0)
  let omittedBytes =
    state.omittedBytes + preOmittedBytes + Math.max(0, encoded.byteLength - byteLimit)
  while (entries.length > 1 && (retainedBytes > byteLimit || entries.length > lineLimit)) {
    const removed = entries.shift()
    if (removed === undefined) break
    retainedBytes -= removed.bytes
    omittedLines += 1
    omittedBytes += removed.bytes
  }
  return { entries, retainedBytes, omittedLines, omittedBytes }
}

interface BoundedLine {
  readonly text: string
  readonly omittedBytes: number
}

/**
 * Retains the UTF-8 suffix that fits within a line's byte budget.
 *
 * @remarks
 * The start offset is advanced past UTF-8 continuation bytes so truncation
 * never leaves an invalid sequence for the decoder. The omitted byte count is
 * retained as evidence that output was bounded.
 *
 * @param text - Accumulated line text.
 * @param byteLimit - Maximum encoded byte length.
 * @returns A valid suffix and the number of omitted bytes.
 */
const utf8Suffix = (text: string, byteLimit: number): BoundedLine => {
  const bytes = encoder.encode(text)
  if (bytes.byteLength <= byteLimit) return { text, omittedBytes: 0 }
  let start = bytes.byteLength - byteLimit
  while (start < bytes.byteLength && (bytes[start]! & 0xc0) === 0x80) start += 1
  return {
    text: decoder.decode(bytes.subarray(start)),
    omittedBytes: start,
  }
}

/**
 * Converts decoded process chunks into bounded observations.
 *
 * @remarks
 * Input is always drained even after bytes are omitted. This prevents a noisy
 * child process from blocking the supervisor while retaining deterministic
 * suffixes for diagnostics.
 *
 * @param output - Process stream to consume.
 * @param byteLimit - Maximum retained bytes for an unfinished line.
 * @param emit - Sink for each completed bounded line.
 * @returns An effect that completes after the stream has been fully drained.
 */
const drainDecodedChunks = (
  output: Stream.Stream<string, unknown>,
  byteLimit: number,
  emit: (line: BoundedLine) => Effect.Effect<void>,
) =>
  Effect.suspend(() => {
    let pending = ""
    let omittedBytes = 0

    const append = (text: string) => {
      const bounded = utf8Suffix(pending + text, byteLimit)
      pending = bounded.text
      omittedBytes += bounded.omittedBytes
    }
    const complete = (): BoundedLine => {
      const text = pending.endsWith("\r") ? pending.slice(0, -1) : pending
      const line = { text, omittedBytes }
      pending = ""
      omittedBytes = 0
      return line
    }
    const consume = (chunk: string) => {
      const lines: Array<BoundedLine> = []
      let offset = 0
      for (;;) {
        const newline = chunk.indexOf("\n", offset)
        if (newline === -1) {
          append(chunk.slice(offset))
          return lines
        }
        append(chunk.slice(offset, newline))
        lines.push(complete())
        offset = newline + 1
      }
    }

    return Stream.runForEach(output, (chunk) =>
      Effect.forEach(consume(chunk), emit, { discard: true }),
    ).pipe(
      Effect.ensuring(
        Effect.suspend(() =>
          pending.length === 0 && omittedBytes === 0 ? Effect.void : emit(complete()),
        ),
      ),
    )
  })

const snapshot = (state: ObservationBuffer, sequence: number, timestampMillis: number) => {
  const entries = state.entries.map(({ observation }) => observation)
  return state.omittedLines === 0
    ? entries
    : [
        ...entries,
        {
          sequence,
          timestampMillis,
          stream: "supervisor" as const,
          text: `output truncated: omittedLines=${state.omittedLines} omittedBytes=${state.omittedBytes} retainedBytes=${state.retainedBytes}`,
        },
      ]
}

const drainCause = (outcomes: readonly [Exit.Exit<void, unknown>, Exit.Exit<void, unknown>]) => {
  const [stdoutExit, stderrExit] = outcomes
  const failures: Array<{ readonly stream: "stdout" | "stderr"; readonly cause: unknown }> = []
  if (Exit.isFailure(stdoutExit)) failures.push({ stream: "stdout", cause: stdoutExit.cause })
  if (Exit.isFailure(stderrExit)) failures.push({ stream: "stderr", cause: stderrExit.cause })
  return failures.length === 0 ? null : failures
}

const makeService = (backend: ProcessBackend): Service => {
  const startInternal = (spec: ProcessSpec) =>
    Effect.gen(function* () {
      const observations = yield* Ref.make<ObservationBuffer>(emptyBuffer)
      const sequence = yield* Ref.make(0)
      const byteLimit = positiveLimit(spec.retainedOutputBytes, defaultRetainedOutputBytes)
      const lineLimit = positiveLimit(spec.retainedOutputLines, defaultRetainedOutputLines)
      const observationsSnapshot = Effect.gen(function* () {
        const timestampMillis = yield* Clock.currentTimeMillis
        return snapshot(yield* Ref.get(observations), yield* Ref.get(sequence), timestampMillis)
      })
      const record = (stream: ProcessObservation["stream"], text: string, preOmittedBytes = 0) =>
        Effect.gen(function* () {
          const timestampMillis = yield* Clock.currentTimeMillis
          const current = yield* Ref.getAndUpdate(sequence, (value) => value + 1)
          yield* Ref.update(observations, (state) =>
            retain(
              state,
              { sequence: current, timestampMillis, stream, text },
              byteLimit,
              lineLimit,
              preOmittedBytes,
              preOmittedBytes === 0 ? 0 : 1,
            ),
          )
        })
      const fail = <A>(
        reason: ProcessFailure["reason"],
        cause: unknown,
      ): Effect.Effect<A, ProcessFailure> =>
        observationsSnapshot.pipe(
          Effect.flatMap((entries) =>
            Effect.fail(new ProcessFailure({ reason, spec, observations: entries, cause })),
          ),
        )
      const handle = yield* backend
        .spawn(spec)
        .pipe(Effect.catch((cause) => fail<ProcessHandle>("spawn", cause)))
      const drain = (stream: "stdout" | "stderr", output: Stream.Stream<string, unknown>) =>
        drainDecodedChunks(output, byteLimit, ({ text, omittedBytes }) =>
          record(stream, text, omittedBytes),
        )
      const stdout = yield* drain("stdout", handle.stdout).pipe(Effect.forkChild)
      const stderr = yield* drain("stderr", handle.stderr).pipe(Effect.forkChild)
      yield* Effect.addFinalizer(() => Fiber.interrupt(stdout))
      yield* Effect.addFinalizer(() => Fiber.interrupt(stderr))
      const drainOutcomes = Effect.all([Fiber.await(stdout), Fiber.await(stderr)], {
        concurrency: "unbounded",
      })
      const exitCode = Effect.all([drainOutcomes, Effect.exit(handle.exitCode)], {
        concurrency: "unbounded",
      }).pipe(
        Effect.flatMap(([drains, process]) => {
          const streams = drainCause(drains)
          if (streams !== null) {
            return fail<number>(
              "stream",
              Exit.isFailure(process) ? { streams, exit: process.cause } : { streams },
            )
          }
          return Exit.isFailure(process)
            ? fail<number>("exit", process.cause)
            : Effect.succeed(process.value)
        }),
      )
      const terminationMessage = yield* Ref.make<string | null>(null)
      const terminateOnce = yield* Effect.cached(
        Ref.get(terminationMessage).pipe(
          Effect.map((message) => message ?? "termination requested"),
          Effect.flatMap((message) => record("supervisor", message)),
          Effect.andThen(
            Effect.all(
              [Effect.exit(handle.terminate(spec.terminationGraceMillis ?? 5_000)), drainOutcomes],
              { concurrency: "unbounded" },
            ),
          ),
          Effect.flatMap(([termination, drains]) => {
            const streams = drainCause(drains)
            if (Exit.isFailure(termination)) {
              return fail<void>(
                "exit",
                streams === null
                  ? { termination: termination.cause }
                  : { termination: termination.cause, streams },
              )
            }
            return streams === null ? Effect.void : fail<void>("stream", { streams })
          }),
        ),
      )
      const terminateWith = (message: string) =>
        Ref.update(terminationMessage, (current) => current ?? message).pipe(
          Effect.andThen(terminateOnce),
        )
      return {
        exitCode,
        observations: observationsSnapshot,
        terminate: terminateWith("termination requested"),
        terminateWith,
        cleanupDescendants: handle
          .terminate(spec.terminationGraceMillis ?? 5_000)
          .pipe(Effect.ignore),
        fail,
      }
    })
  const start: Service["start"] = (spec) =>
    startInternal(spec).pipe(
      Effect.map(({ exitCode, observations, terminate }) => ({
        exitCode,
        observations,
        terminate,
      })),
    )
  const run: Service["run"] = (spec) =>
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* startInternal(spec)
        const exitCode = yield* running.exitCode.pipe(
          Effect.timeoutOrElse({
            duration: spec.timeoutMillis,
            orElse: () =>
              running.terminateWith(`timeout after ${spec.timeoutMillis}ms`).pipe(
                Effect.catch((cause) => running.fail<void>("timeout", cause)),
                Effect.andThen(
                  running.fail<number>("timeout", `timeout after ${spec.timeoutMillis}ms`),
                ),
              ),
          }),
        )
        // A successful command can still leave descendants in its detached process group.
        // Best-effort cleanup prevents those processes from mutating reports or consuming CI.
        yield* running.cleanupDescendants
        return { exitCode, observations: yield* running.observations }
      }),
    )
  return { start, run }
}

/**
 * Builds a process supervisor from an injected backend.
 *
 * @param backend - Process backend used to spawn handles.
 * @returns A layer providing {@link ProcessSupervisor}.
 */
export const layerFromBackend = (backend: ProcessBackend) =>
  Layer.succeed(ProcessSupervisor, ProcessSupervisor.of(makeService(backend)))

/**
 * Builds the production supervisor from Effect's child-process spawner.
 *
 * @returns A layer providing {@link ProcessSupervisor}.
 */
export const layer: Layer.Layer<ProcessSupervisor, never, ChildProcessSpawner.ChildProcessSpawner> =
  Layer.effect(
    ProcessSupervisor,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const backend: ProcessBackend = {
        spawn: (spec) =>
          spawner
            .spawn(
              ChildProcess.make(spec.command, spec.args ?? [], {
                ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
                ...(spec.env === undefined ? {} : { env: { ...spec.env }, extendEnv: true }),
                stdout: "pipe",
                stderr: "pipe",
                killSignal: "SIGTERM",
                forceKillAfter: spec.terminationGraceMillis ?? 5_000,
              }),
            )
            .pipe(
              Effect.map((handle) => ({
                stdout: handle.stdout.pipe(Stream.decodeText()),
                stderr: handle.stderr.pipe(Stream.decodeText()),
                exitCode: handle.exitCode.pipe(Effect.map(Number)),
                terminate: (graceMillis) =>
                  handle.kill({ killSignal: "SIGTERM", forceKillAfter: graceMillis }),
              })),
            ),
      }
      return ProcessSupervisor.of(makeService(backend))
    }),
  )
