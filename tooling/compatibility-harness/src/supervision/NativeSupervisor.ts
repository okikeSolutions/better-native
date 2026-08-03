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
  TestSourceId,
  type RunRecord as RunRecordType,
  type ExecutionUnit,
} from "../Domain.ts"
import type { BuildOutput } from "../build/BuildPipeline.ts"
import { EvidenceStore } from "../evidence/EvidenceStore.ts"
import { PlatformDrivers, type NativeDevice } from "./PlatformDrivers.ts"
import * as RunProtocol from "../protocol/RunProtocol.ts"
import * as NativeMaestroFlow from "./NativeMaestroFlow.ts"

const maestroFlowRetries = 1

export interface NativeRunRequest {
  readonly id: string
  readonly build: BuildOutput
  readonly device: NativeDevice
  readonly unit: ExecutionUnit
  readonly permissionState: "granted" | "reset"
  readonly timeoutMillis: number
  /** @internal A batch owns setup and cleanup for prepared source runs. */
  readonly session?: "isolated" | "prepared"
}

export interface NativeBatchRequest {
  readonly id: string
  readonly build: BuildOutput
  readonly device: NativeDevice
  readonly units: ReadonlyArray<ExecutionUnit>
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
  readonly runBatch: (
    request: NativeBatchRequest,
  ) => Effect.Effect<ReadonlyArray<RunRecordType>, NativeSupervisorError>
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
            unit: request.unit,
            timeoutMillis: request.timeoutMillis,
            retries: maestroFlowRetries,
          }
          const device: RunRecordType["device"] = {
            id: DeviceId.make(request.device.id),
            platform: request.device.platform,
            kind: request.device.platform === "ios" ? "simulator" : "emulator",
            name: request.device.id,
            osVersion: null,
            runtimeVersion: null,
          }
          const flowArtifact = yield* evidence
            .writeBytes(
              "runs",
              request.id,
              "flow.yaml",
              "application/yaml",
              new TextEncoder().encode(NativeMaestroFlow.make(request)),
            )
            .pipe(
              Effect.mapError(
                (cause) => new NativeSupervisorError({ phase: "evidence", request, cause }),
              ),
            )
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
              if (request.session !== "prepared") {
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
              }
              const maestroObservations = yield* drivers
                .runMaestroFlow(request.device, flowArtifact.path, request.timeoutMillis)
                .pipe(Effect.retry(Schedule.recurs(maestroFlowRetries)))
              const poll = Effect.gen(function* () {
                const json = yield* drivers.result(request.device)
                if (json !== null)
                  return {
                    json,
                    logs: [...maestroObservations, ...(yield* drivers.logs(request.device))],
                  }
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
            const cleanup = yield* Effect.exit(
              request.session === "prepared" ? Effect.void : drivers.cleanup(request.device),
            )
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
                sourceId: request.unit.sourceId,
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
                  artifacts: [flowArtifact.id],
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
      const runBatch: Service["runBatch"] = (request) =>
        Effect.gen(function* () {
          const firstUnit = request.units[0]
          if (firstUnit === undefined) {
            return yield* new NativeSupervisorError({
              phase: "device",
              request: {
                ...request,
                unit: {
                  id: "empty",
                  runner: "native-app",
                  platform: request.device.platform,
                  sourceId: TestSourceId.make("empty"),
                },
              },
              cause: "native batch has no execution units",
            })
          }
          const batchRequest = { ...request, unit: firstUnit }
          yield* drivers.reset(request.device).pipe(
            Effect.andThen(drivers.install(request.device, request.build.output)),
            Effect.andThen(
              request.permissionState === "granted"
                ? drivers.grantPermissions(request.device)
                : Effect.void,
            ),
            Effect.mapError(
              (cause) =>
                new NativeSupervisorError({ phase: "device", request: batchRequest, cause }),
            ),
          )
          const launch = yield* drivers
            .launch(request.device)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new NativeSupervisorError({ phase: "device", request: batchRequest, cause }),
              ),
            )
          if (launch.crashed) {
            return yield* new NativeSupervisorError({
              phase: "crash",
              request: {
                ...request,
                unit: firstUnit,
              },
              cause: "application crashed during launch",
            })
          }
          const outcomes = yield* Effect.forEach(request.units, (unit) =>
            Effect.exit(
              run({
                id: `${request.id}-${unit.id}`,
                build: request.build,
                device: request.device,
                unit,
                permissionState: request.permissionState,
                timeoutMillis: request.timeoutMillis,
                session: "prepared",
              }),
            ),
          )
          const cleanup = yield* Effect.exit(drivers.cleanup(request.device))
          if (Exit.isFailure(cleanup)) {
            return yield* new NativeSupervisorError({
              phase: "device",
              request: { ...request, unit: firstUnit },
              cause: cleanup.cause,
            })
          }
          const failed = outcomes.find(Exit.isFailure)
          if (failed !== undefined && Exit.isFailure(failed)) {
            return yield* new NativeSupervisorError({
              phase: "device",
              request: { ...request, unit: firstUnit },
              cause: failed.cause,
            })
          }
          return outcomes.flatMap((outcome) => (Exit.isSuccess(outcome) ? [outcome.value] : []))
        })
      return NativeSupervisor.of({ run, runBatch })
    }),
  )
