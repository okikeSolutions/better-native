import { assert, describe, it } from "@effect/vitest"
import * as AiError from "effect/unstable/ai/AiError"
import * as Domain from "./Domain.ts"
import * as Isolation from "./security/Isolation.ts"
import {
  agentCheckFailureEvidence,
  gateFailureEvidence,
  infrastructureFailureEvidence,
  infrastructureFailureLogAnnotations,
} from "./TrialRunner.ts"

describe("sanitized failure evidence", () => {
  it("classifies compilation and agent-tool timeouts without retaining diagnostics", () => {
    const transcript: ReadonlyArray<Domain.TranscriptEvent> = [
      {
        type: "tool_result",
        toolCallId: Domain.ToolCallId.make("compile-1"),
        name: "check_submission",
        content: { status: "failed", diagnostics: "PRIVATE-GRADER-MATERIAL" },
      },
      {
        type: "tool_result",
        toolCallId: Domain.ToolCallId.make("compile-2"),
        name: "check_submission",
        content: { status: "timeout", diagnostics: "PRIVATE-TIMEOUT-DETAIL" },
      },
    ]
    const evidence = agentCheckFailureEvidence(transcript)
    assert.deepStrictEqual(evidence, [
      { category: "compilation", phase: "agent" },
      { category: "timeout", phase: "agent" },
    ])
    assert.notInclude(JSON.stringify(evidence), "PRIVATE")
  })

  it("classifies module-load and scenario gates by trusted gate ID", () => {
    const evidence = gateFailureEvidence([
      {
        id: Domain.GateId.make("network.module"),
        required: true,
        result: "fail",
        rationale: "sanitized",
        failureCategory: "module-load",
      },
      {
        id: Domain.GateId.make("network.scenario"),
        required: true,
        result: "fail",
        rationale: "sanitized",
        failureCategory: "scenario",
      },
    ])
    assert.deepStrictEqual(
      evidence.map(({ category }) => category),
      ["module-load", "scenario"],
    )
  })

  it("classifies provider protocol and sandbox timeout failures without error text", () => {
    const provider = AiError.make({
      module: "test",
      method: "generate",
      reason: new AiError.InvalidOutputError({
        description: "PRIVATE-PROVIDER-BODY",
      }),
    })
    const findings = [
      infrastructureFailureEvidence(provider),
      infrastructureFailureEvidence(new Isolation.IsolationFailure({ reason: "timeout" })),
    ]
    assert.deepStrictEqual(findings, [
      { category: "provider-protocol", phase: "provider" },
      { category: "timeout", phase: "sandbox" },
    ])
    assert.notInclude(JSON.stringify(findings), "PRIVATE")
  })

  it("logs only provider tool argument shapes, never values or descriptions", () => {
    const provider = AiError.make({
      module: "test",
      method: "generate",
      reason: new AiError.ToolParameterValidationError({
        toolName: "read",
        toolParams: {
          path: "PRIVATE-PATH",
          offset: null,
          limit: 10,
        },
        description: "PRIVATE-PROVIDER-BODY",
      }),
    })
    const annotations = infrastructureFailureLogAnnotations(provider)

    assert.deepStrictEqual(annotations, {
      failureCategory: "provider-protocol",
      providerErrorType: "ToolParameterValidationError",
      providerToolName: "read",
      providerToolParameterShape: {
        limit: "number",
        offset: "null",
        path: "string",
      },
    })
    assert.notInclude(JSON.stringify(annotations), "PRIVATE")
  })
})
