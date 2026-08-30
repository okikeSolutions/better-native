import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import { RunId, type BuildRecord, type RegistryMetadata } from "../Domain.ts"
import { HarnessError } from "../HarnessError.ts"
import * as AppRegistry from "../registry/AppRegistry.ts"
import { AppBuildImporter } from "../build/AppBuildImporter.ts"
import { NativeSupervisor } from "../supervision/NativeSupervisor.ts"
import {
  deviceIdFlag,
  nativePlatform,
  requireSuccessfulRun,
  runIdFlag,
  shardCountFlag,
  shardIndexFlag,
  timeoutMillisFlag,
} from "./Shared.ts"

const recordPathFlag = Flag.string("record")
const binaryPathFlag = Flag.string("binary")
const nativeSourceFlag = Flag.string("source").pipe(Flag.optional)
const physicalDeviceFlag = Flag.boolean("physical-device").pipe(Flag.withDefault(false))

/** Prevents a capability-scoped binary from running a source it did not compile. */
export const validateCapabilityShell = (
  record: BuildRecord,
  sourceId: string | undefined,
): Effect.Effect<void, HarnessError> => {
  const compiledSource = record.capabilitySource ?? null
  if (compiledSource === null) return Effect.void
  if (sourceId === compiledSource) return Effect.void
  return Effect.fail(
    new HarnessError({
      operation: "validate capability-scoped native shell",
      cause:
        sourceId === undefined
          ? `build ${record.id} contains only ${compiledSource}; pass --source ${JSON.stringify(compiledSource)}`
          : `build ${record.id} contains only ${compiledSource}, not ${sourceId}`,
    }),
  )
}

const selectNativeUnits = (
  metadata: RegistryMetadata,
  platform: "ios" | "android",
  source: Option.Option<string>,
  shardIndex: number,
  shardCount: number,
) =>
  Option.match(source, {
    onNone: () => AppRegistry.appExecutionShards(metadata, platform, shardCount)[shardIndex] ?? [],
    onSome: (sourceId) => {
      const unit = AppRegistry.appExecutionUnitForSource(metadata, platform, sourceId)
      return unit === null ? [] : [unit]
    },
  })

/**
 * Runs one generated native source against an imported build.
 */
export const supervisedNative = Command.make(
  "supervise-native",
  {
    platform: nativePlatform,
    recordPath: recordPathFlag,
    binaryPath: binaryPathFlag,
    source: nativeSourceFlag,
    deviceId: deviceIdFlag,
    physicalDevice: physicalDeviceFlag,
    runId: runIdFlag,
    shardIndex: shardIndexFlag,
    shardCount: shardCountFlag,
    timeoutMillis: timeoutMillisFlag,
  },
  Effect.fn("Command.superviseNative")(function* ({
    platform,
    recordPath,
    binaryPath,
    source,
    deviceId,
    physicalDevice,
    runId,
    shardIndex,
    shardCount,
    timeoutMillis,
  }) {
    if (physicalDevice && Option.isNone(source)) {
      return yield* new HarnessError({
        operation: "validate physical native run",
        cause: "physical CoreDevice runs require one explicit --source capability",
      })
    }
    if (physicalDevice && platform === "android" && deviceId.startsWith("emulator-")) {
      return yield* new HarnessError({
        operation: "validate physical native run",
        cause: `${deviceId} is an Android emulator, not a physical device`,
      })
    }
    if (shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
      return yield* new HarnessError({
        operation: "validate native shard",
        cause: `shard ${shardIndex} is outside shard count ${shardCount}`,
      })
    }
    const builds = yield* AppBuildImporter
    const native = yield* NativeSupervisor
    const metadata = yield* AppRegistry.loadMetadata()
    const units = selectNativeUnits(metadata, platform, source, shardIndex, shardCount)
    if (units.length === 0) {
      return yield* new HarnessError({
        operation: "select native shard",
        cause: `shard ${shardIndex} selected no ${platform} sources`,
      })
    }
    const build = yield* builds.load({ recordPath, binaryPath, platform })
    yield* validateCapabilityShell(build.record, Option.getOrUndefined(source))
    const device = {
      platform,
      id: deviceId,
      applicationId: "dev.betternative.compatibility",
      ...(physicalDevice ? { kind: "physical" as const } : {}),
    } as const
    const records = yield* native.runBatch({
      id: runId,
      build,
      device,
      units,
      timeoutMillis,
    })
    yield* Effect.forEach(records, requireSuccessfulRun, { discard: true })
    return yield* Console.log(
      JSON.stringify(records.map(({ finalInfrastructure }) => finalInfrastructure)),
    )
  }),
).pipe(
  Command.withDescription(
    "Execute one generated Expo source shard against an imported native build",
  ),
)

const upstreamRecordPathFlag = Flag.string("upstream-record")
const upstreamBinaryPathFlag = Flag.string("upstream-binary")
const candidateRecordPathFlag = Flag.string("candidate-record")
const candidateBinaryPathFlag = Flag.string("candidate-binary")

/**
 * Runs paired upstream and candidate native shards.
 */
export const supervisedNativePair = Command.make(
  "supervise-native-pair",
  {
    platform: nativePlatform,
    upstreamRecordPath: upstreamRecordPathFlag,
    upstreamBinaryPath: upstreamBinaryPathFlag,
    candidateRecordPath: candidateRecordPathFlag,
    candidateBinaryPath: candidateBinaryPathFlag,
    source: nativeSourceFlag,
    deviceId: deviceIdFlag,
    physicalDevice: physicalDeviceFlag,
    runId: runIdFlag,
    shardIndex: shardIndexFlag,
    shardCount: shardCountFlag,
    timeoutMillis: timeoutMillisFlag,
  },
  Effect.fn("Command.superviseNativePair")(function* ({
    platform,
    upstreamRecordPath,
    upstreamBinaryPath,
    candidateRecordPath,
    candidateBinaryPath,
    source,
    deviceId,
    physicalDevice,
    runId,
    shardIndex,
    shardCount,
    timeoutMillis,
  }) {
    if (physicalDevice && Option.isNone(source)) {
      return yield* new HarnessError({
        operation: "validate physical native pair",
        cause: "physical CoreDevice pairs require one explicit --source capability",
      })
    }
    if (physicalDevice && platform === "android" && deviceId.startsWith("emulator-")) {
      return yield* new HarnessError({
        operation: "validate physical native pair",
        cause: `${deviceId} is an Android emulator, not a physical device`,
      })
    }
    if (shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
      return yield* new HarnessError({
        operation: "validate native shard",
        cause: `shard ${shardIndex} is outside shard count ${shardCount}`,
      })
    }
    const builds = yield* AppBuildImporter
    const native = yield* NativeSupervisor
    const metadata = yield* AppRegistry.loadMetadata()
    const units = selectNativeUnits(metadata, platform, source, shardIndex, shardCount)
    if (units.length === 0) {
      return yield* new HarnessError({
        operation: "select native shard",
        cause: `shard ${shardIndex} selected no ${platform} sources`,
      })
    }
    const [upstreamBuild, candidateBuild] = yield* Effect.all([
      builds.load({ recordPath: upstreamRecordPath, binaryPath: upstreamBinaryPath, platform }),
      builds.load({ recordPath: candidateRecordPath, binaryPath: candidateBinaryPath, platform }),
    ])
    const selectedSource = Option.getOrUndefined(source)
    yield* validateCapabilityShell(upstreamBuild.record, selectedSource)
    yield* validateCapabilityShell(candidateBuild.record, selectedSource)
    const device = {
      platform,
      id: deviceId,
      applicationId: "dev.betternative.compatibility",
      ...(physicalDevice ? { kind: "physical" as const } : {}),
    } as const
    const upstream = yield* native.runBatch({
      id: RunId.make(`${runId}-upstream`),
      build: upstreamBuild,
      device,
      units,
      timeoutMillis,
    })
    yield* Effect.forEach(upstream, requireSuccessfulRun, { discard: true })
    const candidate = yield* native.runBatch({
      id: RunId.make(`${runId}-candidate`),
      build: candidateBuild,
      device,
      units,
      timeoutMillis,
    })
    yield* Effect.forEach(candidate, requireSuccessfulRun, { discard: true })
    return yield* Console.log(
      JSON.stringify({
        upstream: upstream.map(({ finalInfrastructure }) => finalInfrastructure),
        candidate: candidate.map(({ finalInfrastructure }) => finalInfrastructure),
      }),
    )
  }),
).pipe(
  Command.withDescription(
    "Execute paired upstream and candidate shards sequentially on one native device",
  ),
)
