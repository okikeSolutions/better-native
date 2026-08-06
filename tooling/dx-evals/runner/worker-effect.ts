import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Match from "effect/Match"
import * as WorkerRunner from "effect/unstable/workers/WorkerRunner"
import type { WorkerError } from "effect/unstable/workers/WorkerError"
import type { SupervisorRequest, WorkerResponse } from "./Protocol.ts"
import { makeWorkerRuntime } from "./Runtime.ts"
import * as WorkerSupport from "./WorkerSupport.ts"

const runtime = makeWorkerRuntime()
try {
  await runtime.runPromise(
    Effect.gen(function* () {
      const platform = yield* WorkerRunner.WorkerRunnerPlatform
      const runner = yield* platform.start<WorkerResponse, SupervisorRequest>()
      yield* WorkerSupport.lockDownTrustedWorker
      yield* WorkerSupport.lockDownCandidateImports()
      yield* runner.run(
        (portId, request): Effect.Effect<void, WorkerError> =>
          Effect.gen(function* () {
            const effectFallback = { schemaVersion: 1, kind: "effect-failure" } as const
            const moduleFallback = {
              schemaVersion: 1,
              kind: "effect-failure",
              failureCategory: "module-load",
            } as const
            const observation = yield* WorkerSupport.recoverCandidateImport(
              Effect.gen(function* () {
                const moduleValue = yield* WorkerSupport.importModule(request.entrypoint)
                const candidate = WorkerSupport.getRecordProperty(moduleValue, request.exportName)
                const isRunnableEffect = (
                  value: unknown,
                ): value is Effect.Effect<unknown, WorkerSupport.WorkerExecutionFailure, never> =>
                  Effect.isEffect(value)
                const exit = isRunnableEffect(candidate)
                  ? yield* Effect.exit(
                      candidate.pipe(
                        Effect.updateContext(
                          (_: Context.Context<never>): Context.Context<never> => Context.empty(),
                        ),
                      ),
                    )
                  : undefined
                return Match.value(exit).pipe(
                  Match.when({ _tag: "Success" }, ({ value }) => ({
                    schemaVersion: 1,
                    kind: "effect" as const,
                    value,
                  })),
                  Match.when({ _tag: "Failure" }, () => effectFallback),
                  Match.when(undefined, () => ({
                    schemaVersion: 1,
                    kind: "not-effect" as const,
                  })),
                  Match.exhaustive,
                )
              }),
              moduleFallback,
            )
            return {
              type: "observation" as const,
              nonce: request.nonce,
              observation: yield* WorkerSupport.toJsonOr(observation, moduleFallback),
            }
          }).pipe(
            Effect.catchCause(() =>
              Effect.succeed({
                type: "error" as const,
                nonce: request.nonce,
                reason: "worker-handler-failure",
              }),
            ),
            Effect.flatMap((response) => runner.send(portId, response)),
          ),
      )
    }),
  )
} finally {
  await runtime.dispose()
}
