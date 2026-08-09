import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type * as Schema from "effect/Schema"
import * as WorkerRunner from "effect/unstable/workers/WorkerRunner"
import type { WorkerError } from "effect/unstable/workers/WorkerError"
import type { SupervisorRequest, WorkerResponse } from "./Protocol.ts"
import { makeWorkerRuntime } from "./Runtime.ts"
import * as WorkerSupport from "./WorkerSupport.ts"

const backgroundDouble =
  "/workspace/node_modules/@better-native/background-task/node_modules/expo-background-task/index.js"
const taskManagerDouble =
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
            if (
              request.runnerArguments.length !== 1 ||
              (request.runnerArguments[0] !== "available" &&
                request.runnerArguments[0] !== "restricted")
            ) {
              return yield* WorkerSupport.invalidRequest()
            }
            const scenario = request.runnerArguments[0]
            const backgroundControl = (yield* WorkerSupport.importModule(backgroundDouble)) as {
              configureDxEval(token: string, scenario: string): void
              snapshotDxEval(token: string): {
                readonly registerCalls: ReadonlyArray<{
                  readonly name: string
                  readonly minimumInterval?: number
                }>
                readonly statusCalls: number
              }
            }
            const taskManagerControl = (yield* WorkerSupport.importModule(taskManagerDouble)) as {
              configureDxEval(token: string): void
              invokeDefinedTask(name: string, body: unknown): Promise<void>
              snapshotDxEval(token: string): {
                readonly defineCalls: number
                readonly handlerResult?: Schema.Json
              }
            }
            backgroundControl.configureDxEval(request.nonce, scenario)
            taskManagerControl.configureDxEval(request.nonce)
            yield* WorkerSupport.lockDownCandidateImports({
              controlledModules: [
                {
                  url: `file://${backgroundDouble}`,
                  allowedImporterUrlPrefix:
                    "file:///workspace/node_modules/@better-native/background-task/build/",
                },
                {
                  url: `file://${taskManagerDouble}`,
                  allowedImporterUrlPrefix:
                    "file:///workspace/node_modules/@better-native/task-manager/build/",
                },
              ],
            })
            const fallback = {
              schemaVersion: 1,
              kind: "background-task-consumer",
              scenario,
              effectIsValid: false,
              effectSucceeded: false,
              defineCalls: 0,
              registerCalls: 0,
              statusCalls: 0,
              failureCategory: "module-load" as const,
            }
            const fallbackJson: Schema.Json = fallback
            const observation = yield* WorkerSupport.recoverCandidateImport(
              Effect.gen(function* () {
                const moduleValue = yield* WorkerSupport.importModule(request.entrypoint)
                const before = taskManagerControl.snapshotDxEval(request.nonce)
                if (before.defineCalls === 1) {
                  yield* Effect.tryPromise({
                    try: () =>
                      taskManagerControl.invokeDefinedTask("dx.eval.background", {
                        data: { value: "handled" },
                        error: null,
                        executionInfo: {
                          eventId: "dx-background",
                          taskName: "dx.eval.background",
                        },
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
                const background = backgroundControl.snapshotDxEval(request.nonce)
                const taskManager = taskManagerControl.snapshotDxEval(request.nonce)
                return {
                  schemaVersion: 1,
                  kind: "background-task-consumer",
                  scenario,
                  effectIsValid,
                  effectSucceeded: outcome.effectSucceeded,
                  ...(outcome.value === undefined ? {} : { value: outcome.value }),
                  defineCalls: taskManager.defineCalls,
                  ...(taskManager.handlerResult === undefined
                    ? {}
                    : { handlerResult: taskManager.handlerResult }),
                  registerCalls: background.registerCalls.length,
                  ...(background.registerCalls[0] === undefined
                    ? {}
                    : {
                        registeredName: background.registerCalls[0].name,
                        ...(background.registerCalls[0].minimumInterval === undefined
                          ? {}
                          : { minimumInterval: background.registerCalls[0].minimumInterval }),
                      }),
                  statusCalls: background.statusCalls,
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
