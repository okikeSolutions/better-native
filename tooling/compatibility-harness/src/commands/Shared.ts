import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Flag from "effect/unstable/cli/Flag"
import { BuildId, RunId } from "../Domain.ts"
import { HarnessConfig } from "../HarnessConfig.ts"
import { HarnessError } from "../HarnessError.ts"

/**
 * Fails command execution unless a prior build record succeeded.
 *
 * @param record - Build record and output path returned by the build pipeline.
 * @returns The unchanged record when infrastructure succeeded.
 * @throws {@link HarnessError} when the build infrastructure did not succeed.
 */
export const requireSuccessfulRun = (record: {
  readonly plan: { readonly id: string }
  readonly finalInfrastructure: { readonly _tag: string }
}) =>
  Match.value(record.finalInfrastructure._tag).pipe(
    Match.when("succeeded", () => Effect.void),
    Match.orElse(() =>
      Effect.fail(
        new HarnessError({
          operation: "execute compatibility run",
          cause: `${record.plan.id}: ${JSON.stringify(record.finalInfrastructure)}`,
        }),
      ),
    ),
  )

/** CLI flag selecting upstream or candidate build mode. */
export const buildMode = Flag.choice("mode", ["upstream", "candidate"] as const)
/** CLI flag selecting the build platform. */
export const buildPlatform = Flag.choice("platform", ["web", "ios", "android"] as const)
/** CLI flag validated as a safe build identifier. */
export const buildIdFlag = Flag.string("build-id").pipe(Flag.withSchema(BuildId))
/** CLI timeout flag with the harness default execution budget. */
export const timeoutMillisFlag = Flag.integer("timeout-ms").pipe(Flag.withDefault(1_200_000))
/** Optional supplemental source selecting a capability-scoped native shell. */
export const capabilitySourceFlag = Flag.string("source").pipe(
  Flag.withDescription("Build a reviewed capability-scoped native shell instead of the full suite"),
  Flag.optional,
)
/** Explicit opt-in to native compilation when a reusable shell fails to repack. */
export const allowNativeRebuildFlag = Flag.boolean("allow-native-rebuild").pipe(
  Flag.withDescription(
    "Allow Gradle, CocoaPods, or Xcode compilation when a cached native artifact fails to repack",
  ),
)
/**
 * Candidate revision supplied by the harness configuration, when present.
 *
 * @param config - Loaded harness configuration.
 * @returns The configured candidate revision.
 */
export const configuredCandidateRevision = HarnessConfig.pipe(
  Effect.map((config) => config.githubSha),
)

/**
 * Resolves the candidate revision required by a command mode.
 *
 * @param mode - Upstream or candidate execution mode.
 * @returns `null` for upstream mode or the configured candidate revision.
 * @throws {@link HarnessError} when candidate mode has no configured revision.
 */
export const candidateRevision = (mode: "upstream" | "candidate") =>
  Match.value(mode).pipe(
    Match.when("candidate", () => configuredCandidateRevision),
    Match.when("upstream", () => Effect.succeed(null)),
    Match.exhaustive,
  )

/** CLI flag restricting native commands to iOS or Android. */
export const nativePlatform = Flag.choice("platform", ["ios", "android"] as const)
/** CLI device or simulator identifier. */
export const deviceIdFlag = Flag.string("device-id")
/** CLI flag validated as a safe run identifier. */
export const runIdFlag = Flag.string("run-id").pipe(Flag.withSchema(RunId))
/** Zero-based runner-plan shard index. */
export const shardIndexFlag = Flag.integer("shard-index").pipe(Flag.withDefault(0))
/** Total number of runner-plan shards. */
export const shardCountFlag = Flag.integer("shard-count").pipe(Flag.withDefault(1))
