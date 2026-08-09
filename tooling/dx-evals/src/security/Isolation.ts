import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import type * as PlatformError from "effect/PlatformError"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import * as Config from "../Config.ts"
import * as Domain from "../Domain.ts"
import type * as TaskModel from "../tasks/TaskModel.ts"

/** Output returned by the disposable execution boundary. */
export interface IsolationObservation {
  readonly authenticationNonce: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly truncated: boolean
}

/** Request for one clean-room candidate observation. */
export interface IsolationRequest {
  readonly workspace: string
  readonly entrypoint: Domain.TaskRelativePath
  readonly exportName: Domain.ExportName
  readonly runner?:
    | "observe-effect.ts"
    | "observe-network.ts"
    | "observe-battery.ts"
    | "observe-keep-awake.ts"
    | "observe-secure-store.ts"
    | "observe-sqlite.ts"
    | "observe-task-manager.ts"
    | "observe-background-task.ts"
    | "observe-location.ts"
    | "observe-notifications.ts"
    | "check-types.ts"
  readonly runnerArguments?: ReadonlyArray<string>
  readonly publicCompileContract?: TaskModel.PublicCompileContract
}

/** Failure raised when the isolation backend cannot produce a trustworthy observation. */
export class IsolationFailure extends Data.TaggedError("IsolationFailure")<{
  readonly reason: string
}> {}

/** Disposable execution backend for submitted code. */
export interface Service {
  readonly observe: (
    request: IsolationRequest,
  ) => Effect.Effect<IsolationObservation, IsolationFailure>
}

/** Effect context tag for the untrusted-code isolation boundary. */
export class Isolation extends Context.Service<Isolation, Service>()(
  "@better-native/dx-evals/Isolation",
) {}

interface Capture {
  readonly chunks: ReadonlyArray<Uint8Array>
  readonly retainedBytes: number
  readonly truncated: boolean
}

const capture = (stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>, limit: number) =>
  Stream.runFold(
    stream,
    (): Capture => ({ chunks: [], retainedBytes: 0, truncated: false }),
    (state, chunk) =>
      Match.value(state.retainedBytes >= limit).pipe(
        Match.when(true, () => ({ ...state, truncated: true })),
        Match.when(false, () => {
          const remaining = limit - state.retainedBytes
          const retained = chunk.byteLength <= remaining ? chunk : chunk.slice(0, remaining)
          return {
            chunks: [...state.chunks, retained],
            retainedBytes: state.retainedBytes + retained.byteLength,
            truncated: state.truncated || retained.byteLength !== chunk.byteLength,
          }
        }),
        Match.exhaustive,
      ),
  )

const decodeCapture = (value: Capture): string => {
  const bytes = new Uint8Array(value.retainedBytes)
  let offset = 0
  for (const chunk of value.chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** Builds the complete Podman argument vector used by the production isolation boundary. */
export const makePodmanArgs = (
  config: Config.Service,
  request: IsolationRequest,
  containerName: string,
): ReadonlyArray<string> => [
  "run",
  "--rm",
  "--interactive",
  "--name",
  containerName,
  "--pull",
  "never",
  "--label",
  config.sandboxLabel,
  "--network",
  "none",
  "--user",
  "65532:65532",
  "--env",
  "HOME=/tmp",
  "--pid",
  "private",
  "--ipc",
  "private",
  "--read-only",
  "--cap-drop",
  "all",
  "--security-opt",
  "no-new-privileges",
  "--pids-limit",
  "64",
  "--memory",
  "256m",
  "--cpus",
  "1",
  "--tmpfs",
  "/tmp:rw,noexec,nosuid,nodev,size=16m",
  "--tmpfs",
  "/root:rw,noexec,nosuid,nodev,size=16m",
  "--volume",
  `${request.workspace}:/workspace:ro`,
  "--volume",
  `${config.effectPackageRoot}:/workspace/node_modules/effect:ro`,
  "--volume",
  `${config.evalRunnerRoot}:/runner:ro`,
  "--volume",
  `${config.effectPackageRoot}:/runner/node_modules/effect:ro`,
  ...config.effectRuntimePackages.flatMap((dependency) => [
    "--volume",
    `${dependency.root}:/workspace/node_modules/${dependency.name}:ro`,
    "--volume",
    `${dependency.root}:/runner/node_modules/${dependency.name}:ro`,
  ]),
  ...config.runnerRuntimePackages.flatMap((dependency) => [
    "--volume",
    `${dependency.root}:/runner/node_modules/${dependency.name}:ro`,
  ]),
  config.sandboxImage,
  "node",
  "--disallow-code-generation-from-strings",
  "--experimental-strip-types",
  "--no-warnings",
  `/runner/${request.runner ?? "observe-effect.ts"}`,
]

/** Builds the production rootless-Podman isolation service. */
export const layer: Layer.Layer<
  Isolation,
  never,
  Config.DxEvalConfig | ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> = Layer.effect(
  Isolation,
  Effect.gen(function* () {
    const config = yield* Config.DxEvalConfig
    const crypto = yield* Crypto.Crypto
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const rootlessPreflight = yield* Effect.cached(
      spawner
        .string(
          ChildProcess.make(config.podmanExecutable, [
            "info",
            "--format",
            "{{.Host.Security.Rootless}}",
          ]),
        )
        .pipe(
          Effect.flatMap((output) =>
            output.trim() === "true"
              ? Effect.void
              : Effect.fail(new IsolationFailure({ reason: "podman-must-be-rootless" })),
          ),
          Effect.mapError(
            () =>
              new IsolationFailure({
                reason: "podman-rootless-preflight-failed",
              }),
          ),
        ),
    )
    return Isolation.of({
      observe: (request) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* rootlessPreflight
            const containerName = `better-native-eval-${yield* crypto.randomUUIDv4}`
            const authenticationNonce = yield* crypto.randomUUIDv4
            const args = makePodmanArgs(config, request, containerName)
            yield* Effect.logDebug("Sandbox starting").pipe(
              Effect.annotateLogs({
                containerName,
                entrypoint: request.entrypoint,
                sandboxImage: config.sandboxImage,
                timeoutMilliseconds: config.sandboxTimeoutMilliseconds,
              }),
            )
            const handle = yield* spawner.spawn(
              ChildProcess.make(config.podmanExecutable, args, {
                stdin: "pipe",
                stdout: "pipe",
                stderr: "pipe",
                killSignal: "SIGKILL",
                forceKillAfter: 1_000,
              }),
            )
            const stdoutFiber = yield* Effect.forkScoped(capture(handle.stdout, 65_536))
            const stderrFiber = yield* Effect.forkScoped(capture(handle.stderr, 65_536))
            const exitCodeFiber = yield* Effect.forkScoped(handle.exitCode)
            yield* Stream.make(
              new TextEncoder().encode(
                JSON.stringify({
                  nonce: authenticationNonce,
                  entrypoint: `/workspace/${request.entrypoint}`,
                  exportName: request.exportName,
                  runnerArguments: request.runnerArguments ?? [],
                  ...(request.publicCompileContract === undefined
                    ? {}
                    : { publicCompileContract: request.publicCompileContract }),
                }),
              ),
            ).pipe(Stream.run(handle.stdin))
            const exitCode = yield* Fiber.join(exitCodeFiber).pipe(
              Effect.timeoutOrElse({
                duration: Duration.millis(config.sandboxTimeoutMilliseconds),
                orElse: () =>
                  Effect.logWarning("Sandbox timed out; forcing cleanup").pipe(
                    Effect.annotateLogs({
                      containerName,
                      timeoutMilliseconds: config.sandboxTimeoutMilliseconds,
                    }),
                    Effect.andThen(
                      spawner
                        .string(
                          ChildProcess.make(
                            config.podmanExecutable,
                            ["rm", "--force", "--ignore", "--time", "0", containerName],
                            {
                              stdout: "pipe",
                              stderr: "pipe",
                              killSignal: "SIGKILL",
                            },
                          ),
                        )
                        .pipe(
                          Effect.timeoutOrElse({
                            duration: "5 seconds",
                            orElse: () =>
                              Effect.fail(
                                new IsolationFailure({
                                  reason: "timeout-cleanup-failed",
                                }),
                              ),
                          }),
                          Effect.mapError(
                            () =>
                              new IsolationFailure({
                                reason: "timeout-cleanup-failed",
                              }),
                          ),
                          Effect.andThen(Effect.fail(new IsolationFailure({ reason: "timeout" }))),
                        ),
                    ),
                  ),
              }),
            )
            const [stdout, stderr] = yield* Effect.all([
              Fiber.join(stdoutFiber),
              Fiber.join(stderrFiber),
            ])
            yield* Effect.logDebug("Sandbox completed").pipe(
              Effect.annotateLogs({
                containerName,
                exitCode: Number(exitCode),
              }),
            )
            return {
              authenticationNonce,
              exitCode: Number(exitCode),
              stdout: decodeCapture(stdout),
              stderr: decodeCapture(stderr),
              truncated: stdout.truncated || stderr.truncated,
            }
          }),
        ).pipe(
          Effect.mapError((cause) =>
            Match.value(cause).pipe(
              Match.when(
                (error: unknown): error is IsolationFailure => error instanceof IsolationFailure,
                (error) => error,
              ),
              Match.orElse((error) => new IsolationFailure({ reason: String(error) })),
            ),
          ),
        ),
    })
  }),
)

/** Builds an isolation layer from a deterministic backend for unit tests. */
export const layerFromService = (service: Service) =>
  Layer.succeed(Isolation, Isolation.of(service))
