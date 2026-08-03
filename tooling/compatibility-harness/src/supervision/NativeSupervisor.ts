import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import {
  AppRunSummary,
  AttemptId,
  DeviceId,
  RunId,
  RunRecord,
  type RunRecord as RunRecordType,
  type TestCaseId,
  type TestSourceId,
} from "../Domain.ts"
import type { BuildOutput } from "./BuildPipeline.ts"
import { EvidenceStore } from "./EvidenceStore.ts"
import { PlatformDrivers, type NativeDevice } from "./PlatformDrivers.ts"
import * as RunProtocol from "./RunProtocol.ts"

export interface NativeRunRequest {
  readonly id: string
  readonly build: BuildOutput
  readonly device: NativeDevice
  readonly caseIds: ReadonlyArray<TestCaseId>
  readonly sourceIds: ReadonlyArray<TestSourceId>
  readonly permissionState: "granted" | "reset"
  readonly timeoutMillis: number
}

export class NativeSupervisorError extends Data.TaggedError("NativeSupervisorError")<{
  readonly phase: "device" | "crash" | "protocol" | "timeout" | "evidence"
  readonly request: NativeRunRequest
  readonly cause: unknown
}> {}

export interface Service {
  readonly run: (request: NativeRunRequest) => Effect.Effect<RunRecordType, NativeSupervisorError>
}

export class NativeSupervisor extends Context.Service<NativeSupervisor, Service>()(
  "@better-native/compatibility-harness/NativeSupervisor",
) {}

export const layer: Layer.Layer<NativeSupervisor, never, PlatformDrivers | EvidenceStore> =
  Layer.effect(
    NativeSupervisor,
    Effect.gen(function* () {
      const drivers = yield* PlatformDrivers
      const evidence = yield* EvidenceStore
      const run: Service["run"] = (request) =>
        Effect.gen(function* () {
          const startedAtMillis = yield* Clock.currentTimeMillis
          const runId = RunId.make(request.id)
          const plan: RunRecordType["plan"] = {
            schemaVersion: 1,
            id: runId,
            buildId: request.build.record.id,
            platform: request.device.platform,
            testCases: request.caseIds,
            testSources: request.sourceIds,
            timeoutMillis: request.timeoutMillis,
            retries: 0,
          }
          const device: RunRecordType["device"] = {
            id: DeviceId.make(request.device.id),
            platform: request.device.platform,
            kind: request.device.platform === "ios" ? "simulator" : "emulator",
            name: request.device.id,
            osVersion: null,
            runtimeVersion: null,
          }
          const failureOutcome = (
            error: NativeSupervisorError,
          ): RunRecordType["finalInfrastructure"] =>
            Match.value(error.phase).pipe(
              Match.when("crash", () => ({
                _tag: "crashed" as const,
                signal: null,
                exitCode: null,
              })),
              Match.when("timeout", () => ({
                _tag: "timed-out" as const,
                phase: "native-result",
                timeoutMillis: request.timeoutMillis,
              })),
              Match.when("protocol", () => ({
                _tag: "protocol-error" as const,
                message: String(error.cause),
              })),
              Match.when("device", () => ({
                _tag: "device-unavailable" as const,
                message: String(error.cause),
              })),
              Match.when("evidence", () => ({
                _tag: "runner-failed" as const,
                message: String(error.cause),
              })),
              Match.exhaustive,
            )
          const persistFailure = (error: NativeSupervisorError) =>
            Effect.gen(function* () {
              if (error.phase === "evidence") return
              const finishedAtMillis = yield* Clock.currentTimeMillis
              const observations = yield* drivers
                .logs(request.device)
                .pipe(Effect.orElseSucceed(() => []))
              const infrastructure = failureOutcome(error)
              const record: RunRecordType = {
                schemaVersion: 1,
                plan,
                build: request.build.record,
                device,
                runtimeDiscoveredCaseIds: [],
                attempts: [
                  {
                    schemaVersion: 1,
                    id: AttemptId.make(`${request.id}-1`),
                    runId,
                    attempt: 1,
                    startedAtMillis,
                    finishedAtMillis,
                    infrastructure,
                    results: [],
                    observations,
                    artifacts: [],
                  },
                ],
                finalInfrastructure: infrastructure,
              }
              yield* evidence.writeJson("runs", request.id, "record.json", RunRecord, record)
            }).pipe(Effect.ignore)
          const program = Effect.gen(function* () {
            const execute = Effect.gen(function* () {
              yield* drivers.reset(request.device)
              yield* drivers.install(request.device, request.build.output)
              if (request.permissionState === "granted") {
                yield* drivers.grantPermissions(request.device)
              }
              const launch = yield* drivers.launch(request.device)
              if (launch.crashed) {
                return yield* new NativeSupervisorError({
                  phase: "crash",
                  request,
                  cause: "application crashed during launch",
                })
              }
              const query = new URLSearchParams({ runId: request.id })
              for (const caseId of request.caseIds) query.append("case", caseId)
              for (const sourceId of request.sourceIds) query.append("source", sourceId)
              yield* drivers.openUrl(request.device, `better-native://run?${query.toString()}`)
              const poll = Effect.gen(function* () {
                const json = yield* drivers.result(request.device)
                if (json !== null) return { json, logs: yield* drivers.logs(request.device) }
                if (!(yield* drivers.isAlive(request.device))) {
                  return yield* new NativeSupervisorError({
                    phase: "crash",
                    request,
                    cause: "application exited before emitting its result",
                  })
                }
                return yield* Effect.fail("result sentinel not observed")
              })
              return yield* poll.pipe(
                Effect.retry({
                  schedule: Schedule.spaced(500).pipe(
                    Schedule.upTo({ times: Math.max(1, Math.floor(request.timeoutMillis / 500)) }),
                  ),
                  while: (cause) => cause === "result sentinel not observed",
                }),
                Effect.timeoutOrElse({
                  duration: request.timeoutMillis,
                  orElse: () =>
                    Effect.fail(
                      new NativeSupervisorError({
                        phase: "timeout",
                        request,
                        cause: "in-app result sentinel was not observed",
                      }),
                    ),
                }),
              )
            }).pipe(
              Effect.mapError((cause) =>
                cause instanceof NativeSupervisorError
                  ? cause
                  : new NativeSupervisorError({ phase: "device", request, cause }),
              ),
            )
            const execution = yield* Effect.exit(execute)
            const cleanup = yield* Effect.exit(drivers.cleanup(request.device))
            if (Exit.isFailure(cleanup)) {
              return yield* new NativeSupervisorError({
                phase: "device",
                request,
                cause: cleanup.cause,
              })
            }
            const { json, logs } = yield* execution
            const summary = yield* Effect.try({
              try: () => JSON.parse(json) as unknown,
              catch: (cause) => new NativeSupervisorError({ phase: "protocol", request, cause }),
            }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(AppRunSummary)),
              Effect.mapError((cause) =>
                cause instanceof NativeSupervisorError
                  ? cause
                  : new NativeSupervisorError({ phase: "protocol", request, cause }),
              ),
            )
            yield* RunProtocol.validate(
              {
                runId: request.id,
                buildId: request.build.record.id,
                mode: request.build.record.mode,
                caseIds: request.caseIds,
                sourceIds: request.sourceIds,
              },
              summary,
            ).pipe(
              Effect.mapError(
                (cause) => new NativeSupervisorError({ phase: "protocol", request, cause }),
              ),
            )
            const finishedAtMillis = yield* Clock.currentTimeMillis
            const infrastructure = RunProtocol.infrastructureOf(summary)
            const record: RunRecordType = {
              schemaVersion: 1,
              plan,
              build: request.build.record,
              device,
              runtimeDiscoveredCaseIds: summary.runtimeDiscoveredCaseIds,
              attempts: [
                {
                  schemaVersion: 1,
                  id: AttemptId.make(`${request.id}-1`),
                  runId,
                  attempt: 1,
                  startedAtMillis,
                  finishedAtMillis,
                  infrastructure,
                  results: summary.results,
                  observations: [...request.build.observations, ...logs],
                  artifacts: [],
                },
              ],
              finalInfrastructure: infrastructure,
            }
            yield* evidence
              .writeJson("runs", request.id, "record.json", RunRecord, record)
              .pipe(
                Effect.mapError(
                  (cause) => new NativeSupervisorError({ phase: "evidence", request, cause }),
                ),
              )
            return record
          })
          return yield* program.pipe(Effect.tapError(persistFailure))
        })
      return NativeSupervisor.of({ run })
    }),
  )
