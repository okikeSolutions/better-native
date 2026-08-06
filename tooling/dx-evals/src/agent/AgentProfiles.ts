import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as Domain from "../Domain.ts"
import * as Compaction from "./compaction/Compaction.ts"
import * as VirtualWorkspace from "./tools/VirtualWorkspace.ts"

/** Reviewed OpenRouter routing policy attached to an agent profile. */
export const ProviderPolicy = Schema.Struct({
  only: Schema.NonEmptyArray(Domain.NonEmptyString),
  allowFallbacks: Schema.Boolean,
  requireParameters: Schema.Boolean,
  dataCollection: Schema.Literals(["allow", "deny"]),
  zeroDataRetention: Schema.Boolean,
})
/** Decoded provider-routing policy accepted by {@link ProviderPolicy}. */
export type ProviderPolicy = Schema.Schema.Type<typeof ProviderPolicy>

export const ReasoningEffort = Schema.Literals(["none", "minimal", "low", "medium", "high"])
export type ReasoningEffort = Schema.Schema.Type<typeof ReasoningEffort>

/**
 * Complete model, routing, and resource policy used for one real-agent trial.
 *
 * `observedCostStopUsd` is checked after provider responses and is not a hard request ceiling. The
 * reusable provider key's reviewed server-side limit bounds total eval-key exposure, while the
 * selected campaign budget prevents starting trials beyond its declared allocation.
 */
export const AgentProfile = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  id: Domain.AgentProfileId,
  model: Domain.NonEmptyString,
  reasoningEffort: ReasoningEffort,
  compactionReasoningEffort: ReasoningEffort,
  tokenParameter: Schema.Literals(["max_tokens", "max_completion_tokens"]),
  temperature: Schema.optional(Schema.Number),
  seed: Schema.optional(Schema.Int),
  maxTurns: Domain.PositiveInteger,
  maxOutputTokensPerTurn: Domain.PositiveInteger,
  maxTotalOutputTokens: Domain.PositiveInteger,
  maxObservedTotalTokens: Domain.PositiveInteger,
  timeoutMilliseconds: Domain.PositiveInteger,
  observedCostStopUsd: Domain.PositiveFinite,
  promptCaching: Schema.Literals(["disabled", "system"]),
  compaction: Compaction.Policy,
  workspaceLimits: VirtualWorkspace.Limits,
  providerPolicy: ProviderPolicy,
})
/** Decoded agent profile accepted by {@link AgentProfile}. */
export type AgentProfile = Schema.Schema.Type<typeof AgentProfile>

// This is a runaway-loop circuit breaker, not the agent's working budget. Normal trials stop on
// their reviewed duration, observed-token, or cost limits first.
export const emergencyRequestCap = 64

/** Stable CLI identifiers for every profile in the reviewed registry. */
export const reviewedProfileIds = [
  "deepseek-v4-flash-0731",
  "gpt-5.6-luna",
  "grok-4.5",
  "kimi-k3",
  "claude-sonnet-5",
] as const

const rawProfiles = [
  {
    schemaVersion: 3,
    id: Domain.AgentProfileId.make("deepseek-v4-flash-0731"),
    model: "deepseek/deepseek-v4-flash-0731",
    reasoningEffort: "high",
    compactionReasoningEffort: "none",
    tokenParameter: "max_tokens",
    maxTurns: emergencyRequestCap,
    maxOutputTokensPerTurn: 8_192,
    maxTotalOutputTokens: 32_768,
    maxObservedTotalTokens: 120_000,
    timeoutMilliseconds: 300_000,
    observedCostStopUsd: 0.05,
    promptCaching: "disabled",
    compaction: Compaction.defaultPolicy,
    workspaceLimits: VirtualWorkspace.defaultLimits,
    providerPolicy: {
      only: ["deepinfra/fp4"],
      allowFallbacks: false,
      requireParameters: true,
      dataCollection: "deny",
      zeroDataRetention: true,
    },
  },
  {
    schemaVersion: 3,
    id: Domain.AgentProfileId.make("gpt-5.6-luna"),
    model: "openai/gpt-5.6-luna",
    reasoningEffort: "medium",
    compactionReasoningEffort: "none",
    tokenParameter: "max_completion_tokens",
    maxTurns: emergencyRequestCap,
    maxOutputTokensPerTurn: 8_192,
    maxTotalOutputTokens: 32_768,
    maxObservedTotalTokens: 120_000,
    timeoutMilliseconds: 300_000,
    observedCostStopUsd: 0.4,
    promptCaching: "disabled",
    compaction: Compaction.defaultPolicy,
    workspaceLimits: VirtualWorkspace.defaultLimits,
    providerPolicy: {
      only: ["azure"],
      allowFallbacks: false,
      requireParameters: true,
      dataCollection: "deny",
      zeroDataRetention: true,
    },
  },
  {
    schemaVersion: 3,
    id: Domain.AgentProfileId.make("grok-4.5"),
    model: "x-ai/grok-4.5",
    reasoningEffort: "medium",
    compactionReasoningEffort: "medium",
    tokenParameter: "max_tokens",
    maxTurns: emergencyRequestCap,
    maxOutputTokensPerTurn: 8_192,
    maxTotalOutputTokens: 32_768,
    maxObservedTotalTokens: 120_000,
    timeoutMilliseconds: 300_000,
    observedCostStopUsd: 0.5,
    promptCaching: "disabled",
    compaction: Compaction.defaultPolicy,
    workspaceLimits: VirtualWorkspace.defaultLimits,
    providerPolicy: {
      only: ["xai/zdr"],
      allowFallbacks: false,
      requireParameters: true,
      dataCollection: "deny",
      zeroDataRetention: true,
    },
  },
  {
    schemaVersion: 3,
    id: Domain.AgentProfileId.make("kimi-k3"),
    model: "moonshotai/kimi-k3",
    reasoningEffort: "medium",
    compactionReasoningEffort: "none",
    tokenParameter: "max_tokens",
    maxTurns: emergencyRequestCap,
    maxOutputTokensPerTurn: 8_192,
    maxTotalOutputTokens: 32_768,
    maxObservedTotalTokens: 120_000,
    timeoutMilliseconds: 300_000,
    observedCostStopUsd: 0.9,
    promptCaching: "disabled",
    compaction: Compaction.defaultPolicy,
    workspaceLimits: VirtualWorkspace.defaultLimits,
    providerPolicy: {
      only: ["moonshotai/mxfp4"],
      allowFallbacks: false,
      requireParameters: true,
      dataCollection: "deny",
      zeroDataRetention: true,
    },
  },
  {
    schemaVersion: 3,
    id: Domain.AgentProfileId.make("claude-sonnet-5"),
    model: "anthropic/claude-sonnet-5",
    reasoningEffort: "medium",
    compactionReasoningEffort: "none",
    tokenParameter: "max_tokens",
    maxTurns: emergencyRequestCap,
    maxOutputTokensPerTurn: 8_192,
    maxTotalOutputTokens: 32_768,
    maxObservedTotalTokens: 120_000,
    timeoutMilliseconds: 300_000,
    observedCostStopUsd: 0.65,
    promptCaching: "disabled",
    compaction: Compaction.defaultPolicy,
    workspaceLimits: VirtualWorkspace.defaultLimits,
    providerPolicy: {
      only: ["amazon-bedrock/global"],
      allowFallbacks: false,
      requireParameters: true,
      dataCollection: "deny",
      zeroDataRetention: true,
    },
  },
] as const

/** Mutually exclusive OpenRouter output-token parameter selected by a reviewed profile. */
export type TokenLimitConfig =
  | { readonly max_tokens: number; readonly max_completion_tokens?: never }
  | { readonly max_tokens?: never; readonly max_completion_tokens: number }

/** Builds the exact provider token-limit field without sending both aliases. */
export const tokenLimitConfig = (
  profile: Pick<AgentProfile, "tokenParameter">,
  maximumTokens: number,
): TokenLimitConfig =>
  Match.value(profile.tokenParameter).pipe(
    Match.when("max_tokens", () => ({ max_tokens: maximumTokens })),
    Match.when("max_completion_tokens", () => ({
      max_completion_tokens: maximumTokens,
    })),
    Match.exhaustive,
  )

// Keep checked-in policy convenient to review, but still decode it at runtime so an invalid edit
// cannot silently enter a paid campaign through TypeScript's structural `satisfies` check alone.
const profiles = Schema.decodeUnknownSync(Schema.Array(AgentProfile))(rawProfiles)

/** Failure raised when a trial selects an unreviewed agent profile. */
export class AgentProfileNotFound extends Data.TaggedError("AgentProfileNotFound")<{
  readonly profileId: Domain.AgentProfileId
}> {}

/** Reviewed profile-registry operations. */
export interface Service {
  readonly get: (
    profileId: Domain.AgentProfileId,
  ) => Effect.Effect<AgentProfile, AgentProfileNotFound>
  readonly list: Effect.Effect<ReadonlyArray<AgentProfile>>
}

/** Effect service containing the reviewed agent-profile registry. */
export class AgentProfiles extends Context.Service<AgentProfiles, Service>()(
  "@better-native/dx-evals/AgentProfiles",
) {}

const registry = new Map(profiles.map((profile) => [profile.id, profile]))

/** Returns one already-decoded reviewed profile for deterministic live-suite assertions. */
export const getReviewedProfile = (profileId: Domain.AgentProfileId): AgentProfile | undefined =>
  registry.get(profileId)

/** Layer containing the checked-in model matrix. */
export const layer = Layer.succeed(
  AgentProfiles,
  AgentProfiles.of({
    get: (profileId) => {
      const profile = registry.get(profileId)
      return profile === undefined
        ? Effect.fail(new AgentProfileNotFound({ profileId }))
        : Effect.succeed(profile)
    },
    list: Effect.succeed(profiles),
  }),
)
