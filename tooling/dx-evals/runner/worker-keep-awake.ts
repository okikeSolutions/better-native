import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import type * as Schema from "effect/Schema"
import * as WorkerRunner from "effect/unstable/workers/WorkerRunner"
import type { WorkerError } from "effect/unstable/workers/WorkerError"
import type { SupervisorRequest, WorkerResponse } from "./Protocol.ts"
import { makeWorkerRuntime } from "./Runtime.ts"
import * as WorkerSupport from "./WorkerSupport.ts"

const controlledDouble =
  "/workspace/node_modules/@better-native/keep-awake/node_modules/expo-keep-awake/index.js"

interface ControlSnapshot {
  readonly availabilityChecks: number
  readonly activations: number
  readonly deactivations: number
  readonly activatedTags: ReadonlyArray<string>
  readonly deactivatedTags: ReadonlyArray<string>
}

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
            if (
              scenario !== "active-until-interrupt" &&
              scenario !== "unavailable" &&
              scenario !== "activation-failure"
            ) {
              return yield* WorkerSupport.invalidRequest()
            }
            const { configureDxEval, snapshotDxEval } = (yield* WorkerSupport.importModule(
              controlledDouble,
            )) as {
              configureDxEval(token: string, scenario: string): void
              snapshotDxEval(token: string): ControlSnapshot
            }
            configureDxEval(request.nonce, scenario)
            yield* WorkerSupport.lockDownCandidateImports({
              controlledModuleUrl: `file://${controlledDouble}`,
              allowedImporterUrlPrefix:
                "file:///workspace/node_modules/@better-native/keep-awake/build/",
            })
            const fallback = {
              schemaVersion: 1,
              kind: "keep-awake-consumer",
              effectIsValid: false,
              effectSucceeded: false,
              activeBeforeInterrupt: false,
              availabilityChecks: 0,
              activations: 0,
              deactivations: 0,
              activatedTags: [],
              deactivatedTags: [],
              failureCategory: "module-load" as const,
            }
            const fallbackJson: Schema.Json = fallback
            const observation = yield* WorkerSupport.recoverCandidateImport(
              Effect.gen(function* () {
                const moduleValue = yield* WorkerSupport.importModule(request.entrypoint)
                const effectValue = WorkerSupport.getRecordProperty(moduleValue, request.exportName)
                const isRunnableEffect = (
                  value: unknown,
                ): value is Effect.Effect<unknown, WorkerSupport.WorkerExecutionFailure, never> =>
                  Effect.isEffect(value)
                const effectIsValid = isRunnableEffect(effectValue)
                let activeBeforeInterrupt = false
                let exit: Exit.Exit<unknown, WorkerSupport.WorkerExecutionFailure> | undefined
                if (effectIsValid && scenario === "active-until-interrupt") {
                  const fiber = yield* Effect.forkChild(
                    effectValue.pipe(Effect.mapError(WorkerSupport.candidateEffectFailure)),
                  )
                  yield* Effect.sleep("25 millis")
                  const running = snapshotDxEval(request.nonce)
                  activeBeforeInterrupt = running.activations === 1 && running.deactivations === 0
                  yield* Fiber.interrupt(fiber)
                } else if (effectIsValid) {
                  exit = yield* Effect.exit(
                    effectValue.pipe(Effect.mapError(WorkerSupport.candidateEffectFailure)),
                  )
                }
                const effectSucceeded = exit?._tag === "Success"
                const wrappedFailure =
                  exit?._tag === "Failure"
                    ? exit.cause.reasons.find(Cause.isFailReason)?.error
                    : undefined
                const failure =
                  wrappedFailure instanceof WorkerSupport.WorkerExecutionFailure
                    ? wrappedFailure.cause
                    : undefined
                const failureTag = WorkerSupport.getRecordProperty(failure, "_tag")
                const failureMethod = WorkerSupport.getRecordProperty(failure, "method")
                return {
                  schemaVersion: 1,
                  kind: "keep-awake-consumer",
                  effectIsValid,
                  effectSucceeded,
                  activeBeforeInterrupt,
                  ...(failureTag === undefined ? {} : { failureTag }),
                  ...(failureMethod === undefined ? {} : { failureMethod }),
                  ...snapshotDxEval(request.nonce),
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
