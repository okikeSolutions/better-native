import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type * as Schema from "effect/Schema"
import * as WorkerRunner from "effect/unstable/workers/WorkerRunner"
import type { WorkerError } from "effect/unstable/workers/WorkerError"
import type { SupervisorRequest, WorkerResponse } from "./Protocol.ts"
import { makeWorkerRuntime } from "./Runtime.ts"
import * as WorkerSupport from "./WorkerSupport.ts"

const controlledDouble =
  "/workspace/node_modules/@better-native/sqlite/node_modules/expo-sqlite/index.js"

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
            const [scenario] = request.runnerArguments
            if (scenario !== "round-trip" && scenario !== "query-failure") {
              return yield* WorkerSupport.invalidRequest()
            }
            const { configureDxEval, snapshotDxEval } = (yield* WorkerSupport.importModule(
              controlledDouble,
            )) as {
              configureDxEval(token: string, scenario: string): void
              snapshotDxEval(token: string): {
                readonly closeCalls: number
                readonly openCalls: number
                readonly operations: ReadonlyArray<
                  "begin" | "commit" | "rollback" | "create" | "insert" | "select" | "other"
                >
                readonly parametersMatched: boolean
              }
            }
            configureDxEval(request.nonce, scenario)
            yield* WorkerSupport.lockDownCandidateImports({
              controlledModuleUrl: `file://${controlledDouble}`,
              allowedImporterUrlPrefix:
                "file:///workspace/node_modules/@better-native/sqlite/build/",
            })
            const fallback = {
              schemaVersion: 1,
              kind: "sqlite-consumer",
              effectIsValid: false,
              effectSucceeded: false,
              closeCalls: 0,
              openCalls: 0,
              operations: [],
              parametersMatched: false,
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
                    wrappedFailure: undefined,
                  })),
                  Match.when({ _tag: "Failure" }, ({ cause }) => ({
                    effectSucceeded: false as const,
                    value: undefined,
                    wrappedFailure: cause.reasons.find(Cause.isFailReason)?.error,
                  })),
                  Match.when(undefined, () => ({
                    effectSucceeded: false as const,
                    value: undefined,
                    wrappedFailure: undefined,
                  })),
                  Match.exhaustive,
                )
                const failure =
                  outcome.wrappedFailure instanceof WorkerSupport.WorkerExecutionFailure
                    ? outcome.wrappedFailure.cause
                    : undefined
                const failureTag = WorkerSupport.getRecordProperty(failure, "_tag")
                const control = snapshotDxEval(request.nonce)
                return {
                  schemaVersion: 1,
                  kind: "sqlite-consumer",
                  effectIsValid,
                  effectSucceeded: outcome.effectSucceeded,
                  ...(outcome.value === undefined ? {} : { value: outcome.value }),
                  ...(failureTag === undefined ? {} : { failureTag }),
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
