import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import * as AgentProfiles from "./AgentProfiles.ts"
import * as Compaction from "./compaction/Compaction.ts"
import * as VirtualWorkspace from "./tools/VirtualWorkspace.ts"
import * as Domain from "../Domain.ts"

describe("reviewed agent profiles", () => {
  it("names the per-trial dollar threshold as an observed post-response stop", () => {
    const profile = AgentProfiles.getReviewedProfile(Domain.AgentProfileId.make("claude-sonnet-5"))
    assert.strictEqual(profile?.observedCostStopUsd, 0.65)
    assert.isUndefined((profile as { readonly maxCostUsd?: number } | undefined)?.maxCostUsd)
  })

  it("pins the first live run to five privacy-compatible model and provider pairs", () => {
    const expected = [
      [
        "deepseek-v4-flash-0731",
        "deepseek/deepseek-v4-flash-0731",
        "deepinfra/fp4",
        0.05,
        "max_tokens",
      ],
      ["gpt-5.6-luna", "openai/gpt-5.6-luna", "azure", 0.4, "max_completion_tokens"],
      ["grok-4.5", "x-ai/grok-4.5", "xai/zdr", 0.5, "max_tokens"],
      ["kimi-k3", "moonshotai/kimi-k3", "moonshotai/mxfp4", 0.9, "max_tokens"],
      ["claude-sonnet-5", "anthropic/claude-sonnet-5", "amazon-bedrock/global", 0.65, "max_tokens"],
    ] as const

    assert.deepStrictEqual(
      [...AgentProfiles.reviewedProfileIds],
      expected.map(([id]) => id),
    )

    for (const [id, model, provider, costStop, tokenParameter] of expected) {
      const profile = AgentProfiles.getReviewedProfile(Domain.AgentProfileId.make(id))
      assert.strictEqual(profile?.model, model)
      assert.deepStrictEqual(profile?.providerPolicy.only, [provider])
      assert.strictEqual(profile?.providerPolicy.allowFallbacks, false)
      assert.strictEqual(profile?.providerPolicy.requireParameters, true)
      assert.strictEqual(profile?.providerPolicy.dataCollection, "deny")
      assert.strictEqual(profile?.providerPolicy.zeroDataRetention, true)
      assert.strictEqual(profile?.observedCostStopUsd, costStop)
      assert.strictEqual(profile?.tokenParameter, tokenParameter)
      assert.strictEqual(profile?.maxTurns, AgentProfiles.emergencyRequestCap)
      assert.strictEqual(profile?.compactionReasoningEffort, id === "grok-4.5" ? "medium" : "none")
    }
  })

  it("rejects an empty provider allowlist at the runtime boundary", () => {
    const decoded = Schema.decodeUnknownOption(AgentProfiles.AgentProfile)({
      schemaVersion: 3,
      id: "invalid",
      model: "provider/model",
      reasoningEffort: "none",
      compactionReasoningEffort: "none",
      tokenParameter: "max_tokens",
      maxTurns: 1,
      maxOutputTokensPerTurn: 1,
      maxTotalOutputTokens: 1,
      maxObservedTotalTokens: 1,
      timeoutMilliseconds: 1,
      observedCostStopUsd: 0.01,
      promptCaching: "disabled",
      compaction: Compaction.defaultPolicy,
      workspaceLimits: VirtualWorkspace.defaultLimits,
      providerPolicy: {
        only: [],
        allowFallbacks: false,
        requireParameters: true,
        dataCollection: "deny",
        zeroDataRetention: true,
      },
    })
    assert.strictEqual(decoded._tag, "None")
  })

  it("rejects inconsistent compaction policy at the runtime boundary", () => {
    const decoded = Schema.decodeUnknownOption(Compaction.Policy)({
      ...Compaction.defaultPolicy,
      maximumTokens: 100,
      reserveTokens: 80,
      keepRecentTokens: 30,
    })
    assert.strictEqual(decoded._tag, "None")
  })
})
