import * as Data from "effect/Data"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Match from "effect/Match"
import type * as Schema from "effect/Schema"
import { isBuiltin, registerHooks } from "node:module"
import * as WorkerThreads from "node:worker_threads"

const stringifyJson = JSON.stringify.bind(JSON)
const parseJson = JSON.parse.bind(JSON)

/** Reads one property only from a non-null record-like candidate value. */
export const getRecordProperty = (value: unknown, property: PropertyKey): unknown =>
  Match.value(value).pipe(
    Match.when(Match.record, (record) => Reflect.get(record, property)),
    Match.orElse(() => undefined),
  )

/** Typed worker-boundary failure for module loading and JSON normalization. */
export class WorkerExecutionFailure extends Data.TaggedError("WorkerExecutionFailure")<{
  readonly operation:
    | "import"
    | "encode-observation"
    | "invalid-request"
    | "candidate-effect"
    | "lockdown"
  readonly cause?: unknown
}> {}

/**
 * Locks the Effect worker's trusted reply capability before any candidate module is imported.
 *
 * NodeWorkerRunner deliberately uses the worker thread's `parentPort`. Candidate code shares the
 * JavaScript realm, so leaving that mutable would let a top-level module replace `postMessage` and
 * rewrite the later nonce-bearing response. An own, non-configurable bound method preserves the
 * trusted capability even if the candidate mutates MessagePort prototypes. WebAssembly is removed
 * as defense in depth; string code generation is disabled by the supervisor process flag.
 */
export const lockDownTrustedWorker = Effect.try({
  try: () => {
    const port = WorkerThreads.parentPort
    if (port === null) throw new Error("worker parent port is unavailable")
    const trustedPostMessage = port.postMessage.bind(port)
    Object.defineProperty(port, "postMessage", {
      value: trustedPostMessage,
      writable: false,
      configurable: false,
    })
    if ("WebAssembly" in globalThis) {
      Object.defineProperty(globalThis, "WebAssembly", {
        value: undefined,
        writable: false,
        configurable: false,
      })
    }
    for (const property of ["getBuiltinModule", "binding", "_linkedBinding", "dlopen"] as const) {
      if (property in process) {
        Object.defineProperty(process, property, {
          value: undefined,
          writable: false,
          configurable: false,
        })
      }
    }
    Object.defineProperty(globalThis, "process", {
      value: process,
      writable: false,
      configurable: false,
    })
    if ("require" in globalThis) {
      Object.defineProperty(globalThis, "require", {
        value: undefined,
        writable: false,
        configurable: false,
      })
    }
  },
  catch: (cause) => new WorkerExecutionFailure({ operation: "lockdown", cause }),
})

/**
 * Installs a synchronous worker-local resolver guard immediately before candidate import.
 *
 * Core modules would otherwise restore capabilities removed from `process` (for example through
 * `node:module` or `node:worker_threads`). Controlled native doubles may only be resolved by the
 * reviewed packed public package which owns them, never directly by the candidate entrypoint.
 */
export const lockDownCandidateImports = (options?: {
  readonly controlledModuleUrl?: string
  readonly allowedImporterUrlPrefix?: string
}) =>
  Effect.try({
    try: () => {
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier.startsWith("node:") || isBuiltin(specifier)) {
            throw new Error("candidate Node builtin imports are disabled")
          }
          const resolved = nextResolve(specifier, context)
          if (resolved.url.startsWith("file:///runner/")) {
            throw new Error("candidate access to trusted runner modules is disabled")
          }
          if (
            options?.controlledModuleUrl !== undefined &&
            resolved.url === options.controlledModuleUrl &&
            (context.parentURL === undefined ||
              options.allowedImporterUrlPrefix === undefined ||
              !context.parentURL.startsWith(options.allowedImporterUrlPrefix))
          ) {
            throw new Error("direct candidate access to the controlled native double is disabled")
          }
          return resolved
        },
      })
    },
    catch: (cause) => new WorkerExecutionFailure({ operation: "lockdown", cause }),
  })

export const importModule = (specifier: string) =>
  Effect.tryPromise({
    try: () => import(specifier) as Promise<unknown>,
    catch: (cause) => new WorkerExecutionFailure({ operation: "import", cause }),
  })

export const toJson = (value: unknown): Effect.Effect<Schema.Json, WorkerExecutionFailure> =>
  Effect.try({
    try: () => parseJson(stringifyJson(value)) as Schema.Json,
    catch: (cause) => new WorkerExecutionFailure({ operation: "encode-observation", cause }),
  })

/** Converts candidate-controlled output to JSON, falling back to a known JSON observation. */
export const toJsonOr = (value: unknown, fallback: Schema.Json): Effect.Effect<Schema.Json> =>
  toJson(value).pipe(Effect.catch(() => Effect.succeed(fallback)))

/** Converts a candidate import or top-level module failure into a task-owned failing observation. */
export const recoverCandidateImport = <A, R>(
  effect: Effect.Effect<A, WorkerExecutionFailure, R>,
  fallback: A,
): Effect.Effect<A, WorkerExecutionFailure, R> =>
  effect.pipe(
    Effect.catchIf(
      (error) => error.operation === "import",
      () => Effect.succeed(fallback),
    ),
  )

export const invalidRequest = () => new WorkerExecutionFailure({ operation: "invalid-request" })

export const candidateEffectFailure = (cause: unknown) =>
  new WorkerExecutionFailure({ operation: "candidate-effect", cause })

/** Outcome of validating and executing one candidate Effect. */
export interface CandidateEffectResult {
  readonly effectIsValid: boolean
  readonly exit: Exit.Exit<unknown, WorkerExecutionFailure> | undefined
}

/** Executes a candidate Effect without inheriting any trusted worker services. */
export const runCandidateEffect = (value: unknown): Effect.Effect<CandidateEffectResult> => {
  const isRunnable = (
    candidate: unknown,
  ): candidate is Effect.Effect<unknown, WorkerExecutionFailure, never> =>
    Effect.isEffect(candidate)
  if (!isRunnable(value)) {
    return Effect.succeed({ effectIsValid: false as const, exit: undefined })
  }
  return value.pipe(
    Effect.mapError(candidateEffectFailure),
    Effect.setContext(Context.empty()),
    Effect.exit,
    Effect.map((exit) => ({ effectIsValid: true as const, exit })),
  )
}
