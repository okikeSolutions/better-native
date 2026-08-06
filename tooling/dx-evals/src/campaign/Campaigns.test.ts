import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Domain from "../Domain.ts"
import * as Campaigns from "./Campaigns.ts"

describe("reviewed eval campaigns", () => {
  it.effect("defines five serialized diagnostic profiles per real task", () =>
    Effect.gen(function* () {
      const campaign = yield* Campaigns.get(Campaigns.defaultCampaignId)
      const plan = yield* Campaigns.makePlan(campaign, "all")

      assert.strictEqual(plan.execution, "serialized")
      assert.strictEqual(plan.trialCount, 10)
      assert.strictEqual(plan.maximumCampaignCostUsd, 4)
      assert.strictEqual(Campaigns.reviewedMaximumKeyLimitUsd, 8)
      assert.deepStrictEqual(
        plan.trials.map(({ taskId }) => taskId),
        [
          "network",
          "network",
          "network",
          "network",
          "network",
          "battery",
          "battery",
          "battery",
          "battery",
          "battery",
        ],
      )
      assert.deepStrictEqual(
        plan.trials.slice(0, 5).map(({ agentProfileId }) => agentProfileId),
        ["deepseek-v4-flash-0731", "gpt-5.6-luna", "grok-4.5", "kimi-k3", "claude-sonnet-5"],
      )
      assert.strictEqual(plan.trials.filter(({ taskId }) => taskId === "network").length, 5)
      assert.strictEqual(plan.trials.filter(({ taskId }) => taskId === "battery").length, 5)
    }),
  )

  it.effect("preserves reviewed ordering when selecting one task subset", () =>
    Effect.gen(function* () {
      const campaign = yield* Campaigns.get(Campaigns.defaultCampaignId)
      const network = yield* Campaigns.makePlan(campaign, "network")
      const battery = yield* Campaigns.makePlan(campaign, "battery")

      assert.strictEqual(network.trialCount, 5)
      assert.strictEqual(battery.trialCount, 5)
      assert.strictEqual(network.maximumCampaignCostUsd, 2.5)
      assert.strictEqual(battery.maximumCampaignCostUsd, 2.5)
      assert.isTrue(network.trials.every(({ taskId }) => taskId === "network"))
      assert.isTrue(battery.trials.every(({ taskId }) => taskId === "battery"))
    }),
  )

  it.effect("selects one reviewed profile for a bounded provider debug run", () =>
    Effect.gen(function* () {
      const campaign = yield* Campaigns.get(Campaigns.defaultCampaignId)
      const luna = yield* Campaigns.makePlan(campaign, "network", "gpt-5.6-luna")

      assert.strictEqual(luna.trialCount, 1)
      assert.strictEqual(luna.profileSelection, "gpt-5.6-luna")
      assert.strictEqual(luna.maximumCampaignCostUsd, 0.4)
      assert.strictEqual(luna.trials[0]?.taskId, "network")
      assert.strictEqual(luna.trials[0]?.agentProfileId, "gpt-5.6-luna")
    }),
  )

  it.effect("defines one bounded cheap Network smoke trial", () =>
    Effect.gen(function* () {
      const campaign = yield* Campaigns.get(Domain.CampaignId.make("checkpoint-5-smoke"))
      const plan = yield* Campaigns.makePlan(campaign, "all")

      assert.strictEqual(plan.execution, "serialized")
      assert.strictEqual(plan.trialCount, 1)
      assert.strictEqual(plan.maximumCampaignCostUsd, 0.05)
      assert.deepStrictEqual(
        plan.trials.map(({ taskId, agentProfileId, model }) => ({
          taskId,
          agentProfileId,
          model,
        })),
        [
          {
            taskId: "network",
            agentProfileId: "deepseek-v4-flash-0731",
            model: "deepseek/deepseek-v4-flash-0731",
          },
        ],
      )
    }),
  )

  it.effect("rejects an empty task selection instead of running a zero-trial campaign", () =>
    Effect.gen(function* () {
      const campaign = yield* Campaigns.get(Domain.CampaignId.make("checkpoint-5-smoke"))
      const failure = yield* Campaigns.makePlan(campaign, "battery").pipe(Effect.flip)

      assert.instanceOf(failure, Campaigns.CampaignTaskSelectionEmpty)
      assert.strictEqual(failure.taskSelection, "battery")
      assert.strictEqual(failure.profileSelection, "all")
    }),
  )
})
