import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as WorkerRunner from "effect/unstable/workers/WorkerRunner"
import type { WorkerError } from "effect/unstable/workers/WorkerError"
import type { SupervisorRequest, WorkerResponse } from "./Protocol.ts"
import { makeWorkerRuntime } from "./Runtime.ts"
import * as WorkerSupport from "./WorkerSupport.ts"

const controlledDouble =
  "/workspace/node_modules/@better-native/network/node_modules/expo-network/index.js"

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
            const [schemaExportName, scenario] = request.runnerArguments
            if (schemaExportName === undefined || scenario === undefined) {
              return yield* WorkerSupport.invalidRequest()
            }
            const { configureDxEval, snapshotDxEval } = (yield* WorkerSupport.importModule(
              controlledDouble,
            )) as {
              configureDxEval(token: string, scenario: string): void
              snapshotDxEval(token: string): { readonly calls: number }
            }
            configureDxEval(request.nonce, scenario)
            yield* WorkerSupport.lockDownCandidateImports({
              controlledModuleUrl: `file://${controlledDouble}`,
              allowedImporterUrlPrefix:
                "file:///workspace/node_modules/@better-native/network/build/",
            })
            const fallback = {
              schemaVersion: 1,
              kind: "network-consumer",
              effectIsValid: false,
              effectSucceeded: false,
              schemaIsValid: false,
              schemaAcceptsOutput: false,
              schemaRejectsInvalid: false,
              nativeCalls: 0,
              failureCategory: "module-load",
            } as const
            const observation = yield* WorkerSupport.recoverCandidateImport(
              Effect.gen(function* () {
                const moduleValue = yield* WorkerSupport.importModule(request.entrypoint)
                const effectValue = WorkerSupport.getRecordProperty(moduleValue, request.exportName)
                const schemaValue = WorkerSupport.getRecordProperty(moduleValue, schemaExportName)
                const schemaIsValid = Schema.isSchema(schemaValue)
                const isRunnableEffect = (
                  value: unknown,
                ): value is Effect.Effect<unknown, WorkerSupport.WorkerExecutionFailure, never> =>
                  Effect.isEffect(value)
                const effectIsValid = isRunnableEffect(effectValue)
                const exit = effectIsValid
                  ? yield* Effect.exit(
                      effectValue.pipe(
                        Effect.updateContext(
                          (_: Context.Context<never>): Context.Context<never> => Context.empty(),
                        ),
                      ),
                    )
                  : undefined
                const effectOutcome = Match.value(exit).pipe(
                  Match.when({ _tag: "Success" }, ({ value }) => ({
                    effectSucceeded: true as const,
                    value,
                  })),
                  Match.when({ _tag: "Failure" }, () => ({
                    effectSucceeded: false as const,
                    value: undefined,
                  })),
                  Match.when(undefined, () => ({
                    effectSucceeded: false as const,
                    value: undefined,
                  })),
                  Match.exhaustive,
                )
                return {
                  schemaVersion: 1,
                  kind: "network-consumer",
                  effectIsValid,
                  effectSucceeded: effectOutcome.effectSucceeded,
                  schemaIsValid,
                  schemaAcceptsOutput: schemaIsValid && Schema.is(schemaValue)(effectOutcome.value),
                  schemaRejectsInvalid:
                    schemaIsValid &&
                    !Schema.is(schemaValue)({}) &&
                    !Schema.is(schemaValue)({ status: "unknown" }) &&
                    !Schema.is(schemaValue)({ status: "available" }),
                  nativeCalls: snapshotDxEval(request.nonce).calls,
                  ...(effectOutcome.value === undefined ? {} : { value: effectOutcome.value }),
                }
              }),
              fallback,
            )
            return {
              type: "observation" as const,
              nonce: request.nonce,
              observation: yield* WorkerSupport.toJsonOr(observation, fallback),
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
