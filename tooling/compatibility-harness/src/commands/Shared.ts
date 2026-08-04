import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Flag from "effect/unstable/cli/Flag"
import { BuildId, RunId } from "../Domain.ts"
import { HarnessConfig } from "../HarnessConfig.ts"
import { HarnessError } from "../HarnessError.ts"

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

export const buildMode = Flag.choice("mode", ["upstream", "candidate"] as const)
export const buildPlatform = Flag.choice("platform", ["web", "ios", "android"] as const)
export const buildIdFlag = Flag.string("build-id").pipe(Flag.withSchema(BuildId))
export const timeoutMillisFlag = Flag.integer("timeout-ms").pipe(Flag.withDefault(1_200_000))
export const configuredCandidateRevision = HarnessConfig.pipe(
  Effect.map((config) => config.githubSha),
)

export const candidateRevision = (mode: "upstream" | "candidate") =>
  Match.value(mode).pipe(
    Match.when("candidate", () => configuredCandidateRevision),
    Match.when("upstream", () => Effect.succeed(null)),
    Match.exhaustive,
  )

export const nativePlatform = Flag.choice("platform", ["ios", "android"] as const)
export const deviceIdFlag = Flag.string("device-id")
export const runIdFlag = Flag.string("run-id").pipe(Flag.withSchema(RunId))
export const shardIndexFlag = Flag.integer("shard-index").pipe(Flag.withDefault(0))
export const shardCountFlag = Flag.integer("shard-count").pipe(Flag.withDefault(1))
