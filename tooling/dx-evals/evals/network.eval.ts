import { afterAll, expect } from "vitest"
import { describeEval } from "vitest-evals"
import { decodeTrialOutcomeSync } from "../src/Domain.ts"
import { dxHarness, getHarnessInvocationCount } from "../src/Harness.ts"
import { RequiredGateJudge } from "../src/reporting/Judges.ts"
import { disposeDxEvalRuntime, dxEvalRuntime } from "../src/Runtime.ts"
import * as RunIdentity from "../src/campaign/RunIdentity.ts"

afterAll(disposeDxEvalRuntime)

const input = {
  schemaVersion: 1,
  taskId: "network",
  taskVersion: "2",
} as const
const suiteRunId =
  process.env.BETTER_NATIVE_EVAL_RUN_ID ??
  RunIdentity.makeDefaultCampaignId(Date.now(), crypto.randomUUID())
const trialRunId = (caseName: string) =>
  dxEvalRuntime.runPromise(RunIdentity.makeTrialRunId(suiteRunId, caseName))

describeEval("Network", { harness: dxHarness }, (it) => {
  it("passes the packed-package reference across every required gate", async ({ run }) => {
    const runId = await trialRunId("network-reference-1")
    const result = await run({ ...input, runId, adapterId: "reference" })
    const outcome = decodeTrialOutcomeSync(result.output)

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: 1 })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(outcome.requiredGates).toHaveLength(5)
    expect(outcome.requiredGates.map((gate) => gate.id)).toEqual([
      "network.public-package-boundary",
      "network.available-state",
      "network.unavailable-error",
      "network.failure-error",
      "network.output-schema",
    ])
    expect(outcome.requiredGates.every((gate) => gate.result === "pass")).toBe(true)
    expect(result.session.events).toHaveLength(4)
  })

  it("rejects the no-op consumer", async ({ run }) => {
    const runId = await trialRunId("network-noop-1")
    const result = await run({ ...input, runId, adapterId: "noop" })
    const outcome = decodeTrialOutcomeSync(result.output)

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(
      outcome.requiredGates.filter((gate) => gate.result === "fail").map((gate) => gate.id),
    ).toEqual([
      "network.public-package-boundary",
      "network.available-state",
      "network.unavailable-error",
      "network.failure-error",
      "network.output-schema",
    ])
  })

  it("rejects collapsed unavailable and failure handling", async ({ run }) => {
    const runId = await trialRunId("network-broken-1")
    const result = await run({ ...input, runId, adapterId: "broken" })
    const outcome = decodeTrialOutcomeSync(result.output)
    const unavailable = outcome.requiredGates.find(
      (gate) => gate.id === "network.unavailable-error",
    )

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(unavailable?.result).toBe("fail")
    expect(unavailable?.rationale).toBe(
      "NetworkUnavailable was not handled as the declared distinct outcome.",
    )
    expect(
      outcome.requiredGates.filter((gate) => gate.result === "fail").map((gate) => gate.id),
    ).toEqual(["network.unavailable-error"])
  })
})
