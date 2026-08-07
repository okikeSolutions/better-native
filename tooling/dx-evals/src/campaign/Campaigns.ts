import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as AgentProfiles from "../agent/AgentProfiles.ts"
import * as Domain from "../Domain.ts"

/** Stable CLI names of every reviewed paid campaign. */
export const campaignNames = ["checkpoint-5-diagnostic", "checkpoint-5-smoke"] as const

/** Task subset accepted by the unified campaign CLI. */
export const TaskSelection = Schema.Literals(["all", "network", "battery", "keep-awake"])
/** Decoded task subset accepted by {@link TaskSelection}. */
export type TaskSelection = Schema.Schema.Type<typeof TaskSelection>

/** Explicit reviewed agent-profile subset accepted by the campaign CLI. */
export const profileSelections = ["all", ...AgentProfiles.reviewedProfileIds] as const
export const ProfileSelection = Schema.Literals(profileSelections)
/** Decoded profile subset accepted by {@link ProfileSelection}. */
export type ProfileSelection = Schema.Schema.Type<typeof ProfileSelection>

/** One explicit real-agent trial in a reviewed campaign. */
export const CampaignTrial = Schema.Struct({
  taskId: Domain.TaskId,
  taskVersion: Domain.TaskVersion,
  agentProfileId: Domain.AgentProfileId,
  repetition: Domain.PositiveInteger,
})
/** Decoded campaign trial accepted by {@link CampaignTrial}. */
export type CampaignTrial = Schema.Schema.Type<typeof CampaignTrial>

/** Reviewed campaign whose ordering and trial count are part of the experiment. */
export const Campaign = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Domain.CampaignId,
  description: Domain.NonEmptyString,
  maximumCampaignCostUsd: Domain.PositiveFinite,
  trials: Schema.NonEmptyArray(CampaignTrial),
})
/** Decoded campaign accepted by {@link Campaign}. */
export type Campaign = Schema.Schema.Type<typeof Campaign>

const rawCampaigns = [
  {
    schemaVersion: 1,
    id: Domain.CampaignId.make("checkpoint-5-smoke"),
    description: "One paid Network smoke trial using the cheapest compatible profile",
    maximumCampaignCostUsd: 0.05,
    trials: [
      {
        taskId: Domain.TaskId.make("network"),
        taskVersion: Domain.TaskVersion.make("3"),
        agentProfileId: Domain.AgentProfileId.make("deepseek-v4-flash-0731"),
        repetition: 1,
      },
    ],
  },
  {
    schemaVersion: 1,
    id: Domain.CampaignId.make("checkpoint-5-diagnostic"),
    description: "Five diagnostic real-agent profiles across Network, Battery, and KeepAwake",
    maximumCampaignCostUsd: 6,
    // Every reviewed model sees all three tasks exactly once. Keeping the task blocks contiguous makes
    // execution and report review predictable without confounding a model with only one task.
    trials: [
      {
        taskId: Domain.TaskId.make("network"),
        taskVersion: Domain.TaskVersion.make("3"),
        agentProfileId: Domain.AgentProfileId.make("deepseek-v4-flash-0731"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("network"),
        taskVersion: Domain.TaskVersion.make("3"),
        agentProfileId: Domain.AgentProfileId.make("gpt-5.6-luna"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("network"),
        taskVersion: Domain.TaskVersion.make("3"),
        agentProfileId: Domain.AgentProfileId.make("grok-4.5"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("network"),
        taskVersion: Domain.TaskVersion.make("3"),
        agentProfileId: Domain.AgentProfileId.make("kimi-k3"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("network"),
        taskVersion: Domain.TaskVersion.make("3"),
        agentProfileId: Domain.AgentProfileId.make("claude-sonnet-5"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("battery"),
        taskVersion: Domain.TaskVersion.make("2"),
        agentProfileId: Domain.AgentProfileId.make("deepseek-v4-flash-0731"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("battery"),
        taskVersion: Domain.TaskVersion.make("2"),
        agentProfileId: Domain.AgentProfileId.make("gpt-5.6-luna"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("battery"),
        taskVersion: Domain.TaskVersion.make("2"),
        agentProfileId: Domain.AgentProfileId.make("grok-4.5"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("battery"),
        taskVersion: Domain.TaskVersion.make("2"),
        agentProfileId: Domain.AgentProfileId.make("kimi-k3"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("battery"),
        taskVersion: Domain.TaskVersion.make("2"),
        agentProfileId: Domain.AgentProfileId.make("claude-sonnet-5"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("keep-awake"),
        taskVersion: Domain.TaskVersion.make("1"),
        agentProfileId: Domain.AgentProfileId.make("deepseek-v4-flash-0731"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("keep-awake"),
        taskVersion: Domain.TaskVersion.make("1"),
        agentProfileId: Domain.AgentProfileId.make("gpt-5.6-luna"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("keep-awake"),
        taskVersion: Domain.TaskVersion.make("1"),
        agentProfileId: Domain.AgentProfileId.make("grok-4.5"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("keep-awake"),
        taskVersion: Domain.TaskVersion.make("1"),
        agentProfileId: Domain.AgentProfileId.make("kimi-k3"),
        repetition: 1,
      },
      {
        taskId: Domain.TaskId.make("keep-awake"),
        taskVersion: Domain.TaskVersion.make("1"),
        agentProfileId: Domain.AgentProfileId.make("claude-sonnet-5"),
        repetition: 1,
      },
    ],
  },
] as const

const campaigns = Schema.decodeUnknownSync(Schema.Array(Campaign))(rawCampaigns)
const registry = new Map(campaigns.map((campaign) => [campaign.id, campaign]))

/** Failure raised when a command selects a campaign outside the reviewed registry. */
export class CampaignNotFound extends Data.TaggedError("CampaignNotFound")<{
  readonly campaignId: Domain.CampaignId
}> {}

/** Failure raised when a reviewed campaign references an unknown agent profile. */
export class CampaignProfileInvalid extends Data.TaggedError("CampaignProfileInvalid")<{
  readonly campaignId: Domain.CampaignId
  readonly agentProfileId: Domain.AgentProfileId
}> {}

/** Failure raised when task and profile filters select no reviewed trials. */
export class CampaignTaskSelectionEmpty extends Data.TaggedError("CampaignTaskSelectionEmpty")<{
  readonly campaignId: Domain.CampaignId
  readonly taskSelection: TaskSelection
  readonly profileSelection: ProfileSelection
}> {}

/** Default reviewed campaign executed by the unified CLI. */
export const defaultCampaignId = Domain.CampaignId.make("checkpoint-5-diagnostic")

/** Returns one reviewed campaign or a typed configuration failure. */
export const get = (campaignId: Domain.CampaignId): Effect.Effect<Campaign, CampaignNotFound> => {
  const campaign = registry.get(campaignId)
  return campaign === undefined
    ? Effect.fail(new CampaignNotFound({ campaignId }))
    : Effect.succeed(campaign)
}

/** Selects a task subset while preserving the reviewed campaign order. */
export const selectTrials = (
  campaign: Campaign,
  task: TaskSelection,
  profile: ProfileSelection = "all",
): ReadonlyArray<CampaignTrial> => {
  const taskTrials = Match.value(task).pipe(
    Match.when("all", () => campaign.trials),
    Match.whenOr("network", "battery", "keep-awake", (taskId) =>
      campaign.trials.filter((trial) => trial.taskId === taskId),
    ),
    Match.exhaustive,
  )
  return Match.value(profile).pipe(
    Match.when("all", () => taskTrials),
    Match.orElse((agentProfileId) =>
      taskTrials.filter((trial) => trial.agentProfileId === agentProfileId),
    ),
  )
}

/** Stable case identity for one reviewed campaign trial. */
export const trialCaseName = (trial: CampaignTrial): string =>
  `${trial.taskId}-v${trial.taskVersion}-${trial.agentProfileId}-${trial.repetition}`

/** Complete no-request plan shared by `evals plan`, paid execution, and workflow review. */
export const makePlan = (
  campaign: Campaign,
  task: TaskSelection,
  profileSelection: ProfileSelection = "all",
) =>
  Effect.gen(function* () {
    const selected = selectTrials(campaign, task, profileSelection)
    if (selected.length === 0) {
      return yield* new CampaignTaskSelectionEmpty({
        campaignId: campaign.id,
        taskSelection: task,
        profileSelection,
      })
    }
    const trials = yield* Effect.forEach(selected, (trial, index) =>
      Effect.gen(function* () {
        const profile = AgentProfiles.getReviewedProfile(trial.agentProfileId)
        if (profile === undefined) {
          return yield* new CampaignProfileInvalid({
            campaignId: campaign.id,
            agentProfileId: trial.agentProfileId,
          })
        }
        return {
          order: index + 1,
          taskId: trial.taskId,
          taskVersion: trial.taskVersion,
          adapterId: "openrouter-coding-agent" as const,
          agentProfileId: profile.id,
          model: profile.model,
          repetition: trial.repetition,
          maxTurns: profile.maxTurns,
          maxTotalOutputTokens: profile.maxTotalOutputTokens,
          maxObservedTotalTokens: profile.maxObservedTotalTokens,
          maxDurationSeconds: profile.timeoutMilliseconds / 1_000,
          observedCostStopUsd: profile.observedCostStopUsd,
          compaction: profile.compaction,
          workspaceLimits: profile.workspaceLimits,
        }
      }),
    )
    return {
      schemaVersion: 1 as const,
      campaignId: campaign.id,
      taskSelection: task,
      profileSelection,
      execution: "serialized" as const,
      paidRequestsMade: false,
      trialCount: trials.length,
      maximumCampaignCostUsd: Math.min(
        campaign.maximumCampaignCostUsd,
        trials.reduce((total, trial) => total + trial.observedCostStopUsd, 0),
      ),
      trials,
    }
  })

/** Reviewed global key ceiling above the full campaign reservation. */
export const reviewedMaximumKeyLimitUsd = 8
