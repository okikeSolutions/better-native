import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type * as Schema from "effect/Schema"
import * as WorkerRunner from "effect/unstable/workers/WorkerRunner"
import type { WorkerError } from "effect/unstable/workers/WorkerError"
import type { SupervisorRequest, WorkerResponse } from "./Protocol.ts"
import { makeWorkerRuntime } from "./Runtime.ts"
import * as WorkerSupport from "./WorkerSupport.ts"

const controlledDouble =
  "/workspace/node_modules/@better-native/task-manager/node_modules/expo-task-manager/index.js"

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
            const { configureDxEval, invokeDefinedTask, snapshotDxEval } =
              (yield* WorkerSupport.importModule(controlledDouble)) as {
                configureDxEval(token: string): void
                invokeDefinedTask(name: string, body: unknown): Promise<void>
                snapshotDxEval(token: string): {
                  readonly defineCalls: number
                  readonly handlerResult?: Schema.Json
                  readonly isDefinedCalls: number
                }
              }
            configureDxEval(request.nonce)
            yield* WorkerSupport.lockDownCandidateImports({
              controlledModuleUrl: `file://${controlledDouble}`,
              allowedImporterUrlPrefix:
                "file:///workspace/node_modules/@better-native/task-manager/build/",
            })
            const fallback = {
              schemaVersion: 1,
              kind: "task-manager-consumer",
              effectIsValid: false,
              effectSucceeded: false,
              defineCalls: 0,
              isDefinedCalls: 0,
              failureCategory: "module-load" as const,
            }
            const fallbackJson: Schema.Json = fallback
            const observation = yield* WorkerSupport.recoverCandidateImport(
              Effect.gen(function* () {
                const moduleValue = yield* WorkerSupport.importModule(request.entrypoint)
                const beforeInvocation = snapshotDxEval(request.nonce)
                if (beforeInvocation.defineCalls === 1) {
                  yield* Effect.tryPromise({
                    try: () =>
                      invokeDefinedTask("dx.eval.task", {
                        data: { value: "handled" },
                        error: null,
                        executionInfo: { eventId: "dx", taskName: "dx.eval.task" },
                      }),
                    catch: WorkerSupport.candidateEffectFailure,
                  })
                }
                const effectValue = WorkerSupport.getRecordProperty(moduleValue, request.exportName)
                const { effectIsValid, exit } = yield* WorkerSupport.runCandidateEffect(effectValue)
                const outcome = Match.value(exit).pipe(
                  Match.when({ _tag: "Success" }, ({ value }) => ({
                    effectSucceeded: true as const,
                    value,
                  })),
                  Match.orElse(() => ({
                    effectSucceeded: false as const,
                    value: undefined,
                  })),
                )
                const control = snapshotDxEval(request.nonce)
                return {
                  schemaVersion: 1,
                  kind: "task-manager-consumer",
                  effectIsValid,
                  effectSucceeded: outcome.effectSucceeded,
                  ...(outcome.value === undefined ? {} : { value: outcome.value }),
                  defineCalls: control.defineCalls,
                  isDefinedCalls: control.isDefinedCalls,
                  ...(control.handlerResult === undefined
                    ? {}
                    : { handlerResult: control.handlerResult }),
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
