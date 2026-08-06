import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as OpenRouterClient from "@effect/ai-openrouter/OpenRouterClient"
import * as OpenRouterLanguageModel from "@effect/ai-openrouter/OpenRouterLanguageModel"
import * as AgentLoop from "./AgentLoop.ts"
import * as AgentProfiles from "./AgentProfiles.ts"
import * as CampaignBudget from "../campaign/CampaignBudget.ts"
import * as Campaigns from "../campaign/Campaigns.ts"
import * as CompileCheck from "./CompileCheck.ts"
import * as Domain from "../Domain.ts"
import * as TaskWorkspace from "../tasks/TaskWorkspace.ts"

/** Whether the trusted controller received an OpenRouter credential. */
export interface AccessService {
  readonly available: boolean
}

/** Process-owned credential-presence service; the secret value is never exposed through it. */
export class OpenRouterAccess extends Context.Service<OpenRouterAccess, AccessService>()(
  "@better-native/dx-evals/OpenRouterAccess",
) {}

const optionalApiKey = Config.option(Config.redacted("OPENROUTER_API_KEY"))

/** Optional credential-presence Layer used by deterministic and live runs alike. */
export const accessLayer = Layer.effect(
  OpenRouterAccess,
  optionalApiKey.pipe(
    Effect.map((value) => OpenRouterAccess.of({ available: Option.isSome(value) })),
  ),
)

/**
 * OpenRouter client Layer attached to the process-owned ManagedRuntime.
 *
 * A missing key does not break free validation; the real adapter rejects before making a request.
 */
export const clientLayer = OpenRouterClient.layerConfig({
  apiKey: optionalApiKey.pipe(Config.map(Option.getOrUndefined)),
  siteTitle: Config.succeed("better-native DX evals"),
})

/** Failure raised when paid execution was requested without controller credentials. */
export class OpenRouterCredentialMissing extends Data.TaggedError("OpenRouterCredentialMissing") {}

/** Fails paid execution before subprocess startup when no controller credential is available. */
export const requireCredential = OpenRouterAccess.pipe(
  Effect.filterOrFail(
    (access) => access.available,
    () => new OpenRouterCredentialMissing(),
  ),
  Effect.asVoid,
)

/** Failure raised when a real adapter input omits its reviewed agent profile. */
export class AgentProfileRequired extends Data.TaggedError("AgentProfileRequired") {}

/** Failure raised when the live key cannot prove the declared server-side spending ceiling. */
export class OpenRouterSpendingLimitInvalid extends Data.TaggedError(
  "OpenRouterSpendingLimitInvalid",
)<{
  readonly reason: "missing-limit" | "limit-too-high" | "insufficient-remaining"
  readonly limit: number | null
  readonly limitRemaining: number | null
}> {}

/** Failure raised when key-budget preflight cannot obtain authenticated key metadata. */
export class OpenRouterKeyPreflightFailed extends Data.TaggedError("OpenRouterKeyPreflightFailed")<{
  readonly cause: unknown
}> {}

/** Validates the reusable eval key and selected campaign allowance before any model request. */
export const validateSpendingLimit = (
  maximumTrialCostUsd: number,
  maximumCampaignCostUsd: number,
  reservedCampaignCostUsd: number,
  key: {
    readonly limit: number | null
    readonly limitRemaining: number | null
  },
) =>
  Effect.gen(function* () {
    if (key.limit === null || key.limitRemaining === null) {
      return yield* new OpenRouterSpendingLimitInvalid({
        reason: "missing-limit",
        limit: key.limit,
        limitRemaining: key.limitRemaining,
      })
    }
    if (key.limit > Campaigns.reviewedMaximumKeyLimitUsd) {
      return yield* new OpenRouterSpendingLimitInvalid({
        reason: "limit-too-high",
        limit: key.limit,
        limitRemaining: key.limitRemaining,
      })
    }
    const requiredRemainingCostUsd = Math.max(
      maximumTrialCostUsd,
      maximumCampaignCostUsd - reservedCampaignCostUsd,
    )
    if (key.limitRemaining < requiredRemainingCostUsd) {
      return yield* new OpenRouterSpendingLimitInvalid({
        reason: "insufficient-remaining",
        limit: key.limit,
        limitRemaining: key.limitRemaining,
      })
    }
    return yield* Effect.void
  })

const runScoped = Effect.fn("DxEvals.OpenRouterAgent.run")(function* (input: Domain.TrialInput) {
  if (input.agentProfileId === undefined) return yield* new AgentProfileRequired()
  yield* requireCredential
  const profiles = yield* AgentProfiles.AgentProfiles
  const profile = yield* profiles.get(input.agentProfileId)
  const openrouter = yield* OpenRouterClient.OpenRouterClient
  const key = yield* openrouter.client
    .getCurrentKey(undefined)
    .pipe(Effect.mapError((cause) => new OpenRouterKeyPreflightFailed({ cause })))
  const budget = yield* CampaignBudget.CampaignBudget
  const budgetSnapshot = yield* budget.snapshot
  yield* validateSpendingLimit(
    profile.observedCostStopUsd,
    budgetSnapshot.maximumCostUsd,
    budgetSnapshot.reservedCostUsd,
    {
      limit: key.data.limit,
      limitRemaining: key.data.limit_remaining,
    },
  )
  yield* Effect.logInfo("OpenRouter spending preflight passed").pipe(
    Effect.annotateLogs({
      maximumCampaignCostUsd: budgetSnapshot.maximumCostUsd,
      reviewedMaximumKeyLimitUsd: Campaigns.reviewedMaximumKeyLimitUsd,
      reservedCampaignCostUsd: budgetSnapshot.reservedCostUsd,
      maximumTrialCostUsd: profile.observedCostStopUsd,
    }),
  )
  yield* budget.reserve(input.runId, profile.observedCostStopUsd)
  yield* Effect.logInfo("Campaign budget reserved").pipe(
    Effect.annotateLogs({ reservedTrialCostUsd: profile.observedCostStopUsd }),
  )
  const task = yield* TaskWorkspace.loadTask(input.taskId)
  const seed = yield* TaskWorkspace.makeAgentWorkspaceSeed(task)
  const checkSubmission = yield* CompileCheck.makeChecker(task)
  const modelContext = yield* Layer.build(modelLayer(profile))
  const result = yield* AgentLoop.run(profile, seed, task.instruction, checkSubmission).pipe(
    Effect.tap(() => Effect.logInfo("Coding-agent loop completed")),
    Effect.provide(modelContext),
    Effect.annotateLogs({
      agentProfileId: profile.id,
      model: profile.model,
      providerAllowlist: profile.providerPolicy.only.join(","),
    }),
    Effect.withLogSpan("coding-agent"),
  )
  if (result.usage.costUsd !== undefined) {
    yield* budget.settle(input.runId, result.usage.costUsd)
    yield* Effect.logInfo("Campaign budget settled").pipe(
      Effect.annotateLogs({ actualTrialCostUsd: result.usage.costUsd }),
    )
  }
  return result
})

/** Builds the exact reviewed Effect AI model Layer shared by trials and protocol probes. */
export const modelLayer = (profile: AgentProfiles.AgentProfile) => {
  const provider = profile.providerPolicy
  return OpenRouterLanguageModel.model(profile.model, {
    ...AgentProfiles.tokenLimitConfig(profile, profile.maxOutputTokensPerTurn),
    reasoning: { effort: profile.reasoningEffort },
    provider: {
      only: provider.only,
      allow_fallbacks: provider.allowFallbacks,
      require_parameters: provider.requireParameters,
      data_collection: provider.dataCollection,
      zdr: provider.zeroDataRetention,
    },
    ...(profile.temperature === undefined ? {} : { temperature: profile.temperature }),
    ...(profile.seed === undefined ? {} : { seed: profile.seed }),
  })
}

/** Executes one reviewed profile through the native Effect AI OpenRouter provider. */
export const run = (input: Domain.TrialInput) => Effect.scoped(runScoped(input))
