import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type * as Schema from "effect/Schema"
import * as WorkerRunner from "effect/unstable/workers/WorkerRunner"
import type { WorkerError } from "effect/unstable/workers/WorkerError"
import type { SupervisorRequest, WorkerResponse } from "./Protocol.ts"
import { makeWorkerRuntime } from "./Runtime.ts"
import * as WorkerSupport from "./WorkerSupport.ts"

const controlledDouble =
  "/workspace/node_modules/@better-native/location/node_modules/expo-location/index.js"

const runtime = makeWorkerRuntime()
try {
  await runtime.runPromise(
    Effect.gen(function* () {
      const platform = yield* WorkerRunner.WorkerRunnerPlatform
      const runner = yield* platform.start<WorkerResponse, SupervisorRequest>()
      yield* WorkerSupport.lockDownTrustedWorker
      yield* runner.run(
        (portId, request): Effect.Effect<void, WorkerError> =>
          Effect.gen(function* () {
            if (request.runnerArguments.length !== 0) return yield* WorkerSupport.invalidRequest()
            const { configureDxEval, snapshotDxEval } = (yield* WorkerSupport.importModule(
              controlledDouble,
            )) as {
              configureDxEval(token: string): void
              snapshotDxEval(token: string): {
                readonly watchCalls: number
                readonly removeCalls: number
              }
            }
            configureDxEval(request.nonce)
            yield* WorkerSupport.lockDownCandidateImports({
              controlledModuleUrl: `file://${controlledDouble}`,
              allowedImporterUrlPrefix:
                "file:///workspace/node_modules/@better-native/location/build/",
            })
            const fallback = {
              schemaVersion: 1,
              kind: "location-consumer",
              effectIsValid: false,
              effectSucceeded: false,
              watchCalls: 0,
              removeCalls: 0,
              failureCategory: "module-load" as const,
            }
            const fallbackJson: Schema.Json = fallback
            const observation = yield* WorkerSupport.recoverCandidateImport(
              Effect.gen(function* () {
                const moduleValue = yield* WorkerSupport.importModule(request.entrypoint)
                const effectValue = WorkerSupport.getRecordProperty(moduleValue, request.exportName)
                const { effectIsValid, exit } = yield* WorkerSupport.runCandidateEffect(effectValue)
                const outcome = Match.value(exit).pipe(
                  Match.when({ _tag: "Success" }, ({ value }) => ({
                    effectSucceeded: true as const,
                    value,
                  })),
                  Match.orElse(() => ({ effectSucceeded: false as const, value: undefined })),
                )
                const control = snapshotDxEval(request.nonce)
                return {
                  schemaVersion: 1,
                  kind: "location-consumer",
                  effectIsValid,
                  effectSucceeded: outcome.effectSucceeded,
                  ...(outcome.value === undefined ? {} : { value: outcome.value }),
                  ...control,
                }
              }),
              fallback,
            )
            return {
              type: "observation" as const,
              nonce: request.nonce,
              observation: yield* WorkerSupport.toJsonOr(observation, fallbackJson),
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
