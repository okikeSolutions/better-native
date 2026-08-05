import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import { RunId } from "../Domain.ts"
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

export const supervisedNative = Command.make(
  "supervise-native",
  {
    platform: nativePlatform,
    recordPath: recordPathFlag,
    binaryPath: binaryPathFlag,
    deviceId: deviceIdFlag,
    runId: runIdFlag,
    shardIndex: shardIndexFlag,
    shardCount: shardCountFlag,
    timeoutMillis: timeoutMillisFlag,
  },
  Effect.fn("Command.superviseNative")(function* ({
    platform,
    recordPath,
    binaryPath,
    deviceId,
    runId,
    shardIndex,
    shardCount,
    timeoutMillis,
  }) {
    if (shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
      return yield* new HarnessError({
        operation: "validate native shard",
        cause: `shard ${shardIndex} is outside shard count ${shardCount}`,
      })
    }
    const builds = yield* AppBuildImporter
    const native = yield* NativeSupervisor
    const metadata = yield* AppRegistry.loadMetadata()
    const units = AppRegistry.appExecutionShards(metadata, platform, shardCount)[shardIndex] ?? []
    if (units.length === 0) {
      return yield* new HarnessError({
        operation: "select native shard",
        cause: `shard ${shardIndex} selected no ${platform} sources`,
      })
    }
    const build = yield* builds.load({ recordPath, binaryPath, platform })
    const device = {
      platform,
      id: deviceId,
      applicationId: "dev.betternative.compatibility",
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

export const supervisedNativePair = Command.make(
  "supervise-native-pair",
  {
    platform: nativePlatform,
    upstreamRecordPath: upstreamRecordPathFlag,
    upstreamBinaryPath: upstreamBinaryPathFlag,
    candidateRecordPath: candidateRecordPathFlag,
    candidateBinaryPath: candidateBinaryPathFlag,
    deviceId: deviceIdFlag,
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
    deviceId,
    runId,
    shardIndex,
    shardCount,
    timeoutMillis,
  }) {
    if (shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
      return yield* new HarnessError({
        operation: "validate native shard",
        cause: `shard ${shardIndex} is outside shard count ${shardCount}`,
      })
    }
    const builds = yield* AppBuildImporter
    const native = yield* NativeSupervisor
    const metadata = yield* AppRegistry.loadMetadata()
    const units = AppRegistry.appExecutionShards(metadata, platform, shardCount)[shardIndex] ?? []
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
    const device = {
      platform,
      id: deviceId,
      applicationId: "dev.betternative.compatibility",
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
