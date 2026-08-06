import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as WorkerRunner from "effect/unstable/workers/WorkerRunner"
import type { WorkerError } from "effect/unstable/workers/WorkerError"
import type { SupervisorRequest, WorkerResponse } from "./Protocol.ts"
import { makeWorkerRuntime } from "./Runtime.ts"
import * as WorkerSupport from "./WorkerSupport.ts"

const controlledDouble =
  "/workspace/node_modules/@better-native/battery/node_modules/expo-battery/index.js"

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
            const [scenario, encodedTake] = request.runnerArguments
            const take = Number(encodedTake)
            if (scenario === undefined || !Number.isSafeInteger(take) || take <= 0) {
              return yield* WorkerSupport.invalidRequest()
            }
            const { configureDxEval, snapshotDxEval } = (yield* WorkerSupport.importModule(
              controlledDouble,
            )) as {
              configureDxEval(token: string, scenario: string): void
              snapshotDxEval(token: string): {
                readonly registrations: number
                readonly removals: number
                readonly emitted: number
              }
            }
            configureDxEval(request.nonce, scenario)
            yield* WorkerSupport.lockDownCandidateImports({
              controlledModuleUrl: `file://${controlledDouble}`,
              allowedImporterUrlPrefix:
                "file:///workspace/node_modules/@better-native/battery/build/",
            })
            const fallback: {
              schemaVersion: number
              kind: string
              streamIsValid: boolean
              streamSucceeded: boolean
              values: Array<unknown>
              registrations: number
              removals: number
              emitted: number
              failureCategory: "module-load"
            } = {
              schemaVersion: 1,
              kind: "battery-consumer",
              streamIsValid: false,
              streamSucceeded: false,
              values: [],
              registrations: 0,
              removals: 0,
              emitted: 0,
              failureCategory: "module-load",
            }
            const fallbackJson: Schema.Json = {
              schemaVersion: 1,
              kind: "battery-consumer",
              streamIsValid: false,
              streamSucceeded: false,
              values: [],
              registrations: 0,
              removals: 0,
              emitted: 0,
              failureCategory: "module-load",
            }
            const observation = yield* WorkerSupport.recoverCandidateImport(
              Effect.gen(function* () {
                const moduleValue = yield* WorkerSupport.importModule(request.entrypoint)
                const streamValue = WorkerSupport.getRecordProperty(moduleValue, request.exportName)
                const isRunnableStream = (
                  value: unknown,
                ): value is Stream.Stream<unknown, unknown, never> => Stream.isStream(value)
                const streamIsValid = isRunnableStream(streamValue)
                const exit = streamIsValid
                  ? yield* Effect.exit(
                      streamValue.pipe(
                        Stream.take(take),
                        Stream.runCollect,
                        Effect.mapError(WorkerSupport.candidateEffectFailure),
                        Effect.updateContext(
                          (_: Context.Context<never>): Context.Context<never> => Context.empty(),
                        ),
                      ),
                    )
                  : undefined
                const streamOutcome = Match.value(exit).pipe(
                  Match.when({ _tag: "Success" }, ({ value }) => ({
                    streamSucceeded: true as const,
                    values: Array.from(value),
                    wrappedFailure: undefined,
                  })),
                  Match.when({ _tag: "Failure" }, ({ cause }) => ({
                    streamSucceeded: false as const,
                    values: [],
                    wrappedFailure: cause.reasons.find(Cause.isFailReason)?.error,
                  })),
                  Match.when(undefined, () => ({
                    streamSucceeded: false as const,
                    values: [],
                    wrappedFailure: undefined,
                  })),
                  Match.exhaustive,
                )
                const failure =
                  streamOutcome.wrappedFailure instanceof WorkerSupport.WorkerExecutionFailure
                    ? streamOutcome.wrappedFailure.cause
                    : undefined
                const control = snapshotDxEval(request.nonce)
                const failureTag = WorkerSupport.getRecordProperty(failure, "_tag")
                const failureMethod = WorkerSupport.getRecordProperty(failure, "method")
                return {
                  schemaVersion: 1,
                  kind: "battery-consumer",
                  streamIsValid,
                  streamSucceeded: streamOutcome.streamSucceeded,
                  values: streamOutcome.values,
                  ...(failureTag === undefined ? {} : { failureTag }),
                  ...(failureMethod === undefined ? {} : { failureMethod }),
                  registrations: control.registrations,
                  removals: control.removals,
                  emitted: control.emitted,
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
