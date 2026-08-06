import { assert, describe, it } from "@effect/vitest"
import * as AiError from "effect/unstable/ai/AiError"
import type * as Generated from "@effect/ai-openrouter/Generated"
import * as AgentProfiles from "./AgentProfiles.ts"
import * as Domain from "../Domain.ts"
import * as ProviderCompatibility from "./ProviderCompatibility.ts"

const profile = AgentProfiles.getReviewedProfile(
  Domain.AgentProfileId.make("deepseek-v4-flash-0731"),
)!

const response = {
  id: "probe-response",
  object: "chat.completion",
  created: 1,
  model: profile.model,
  system_fingerprint: null,
  choices: [
    {
      index: 0,
      finish_reason: "tool_calls",
      logprobs: null,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "compatibility-call",
            type: "function",
            function: { name: "compatibility_ready", arguments: '{"ok":true}' },
          },
        ],
      },
    },
  ],
  usage: {
    prompt_tokens: 9,
    completion_tokens: 3,
    total_tokens: 12,
    cost: 0.000_001,
  },
} satisfies Generated.SendChatCompletionRequest200

describe("provider compatibility probe", () => {
  it("accepts a decoded tool call with provider usage evidence", () => {
    const result = ProviderCompatibility.assessResponse(profile, response)
    assert.strictEqual(result.status, "compatible")
    if (result.status === "compatible") {
      assert.strictEqual(result.routingEvidence, "single-provider-no-fallback")
      assert.strictEqual(result.costUsd, 0.000_001)
    }
  })

  it("quarantines a response that omits the required tool call", () => {
    const result = ProviderCompatibility.assessResponse(profile, {
      ...response,
      choices: [],
    })
    assert.strictEqual(result.status, "quarantined")
    if (result.status === "quarantined") {
      assert.strictEqual(result.reason, "missing-tool-call")
    }
  })

  it("classifies malformed provider output outside task scoring", () => {
    const malformed = AiError.make({
      module: "fake-provider",
      method: "createChatCompletion",
      reason: new AiError.InvalidOutputError({
        description: "missing choices",
      }),
    })
    const result = ProviderCompatibility.classifyFailure(profile, malformed)
    assert.strictEqual(result.status, "quarantined")
    assert.strictEqual(result.reason, "malformed-response")
  })

  it("retains only the tool name for parameter-validation diagnostics", () => {
    const invalidParameters = AiError.make({
      module: "Toolkit",
      method: "read.handle",
      reason: new AiError.ToolParameterValidationError({
        toolName: "read",
        toolParams: { path: "PRIVATE", offset: "PRIVATE-NUMBER" },
        description: "PRIVATE-DESCRIPTION",
      }),
    })
    const result = ProviderCompatibility.classifyFailure(profile, invalidParameters)

    assert.strictEqual(result.providerErrorType, "ToolParameterValidationError")
    assert.strictEqual(result.providerToolName, "read")
    assert.deepStrictEqual(result.providerToolParameterShape, {
      offset: "string",
      path: "string",
    })
    assert.isUndefined(result.providerErrorDescription)
    assert.notInclude(JSON.stringify(result), "PRIVATE")
  })
})
