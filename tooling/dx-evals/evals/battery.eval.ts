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
  taskId: "battery",
  taskVersion: "1",
} as const
const suiteRunId =
  process.env.BETTER_NATIVE_EVAL_RUN_ID ??
  RunIdentity.makeDefaultCampaignId(Date.now(), crypto.randomUUID())
const trialRunId = (caseName: string) =>
  dxEvalRuntime.runPromise(RunIdentity.makeTrialRunId(suiteRunId, caseName))

describeEval("Battery", { harness: dxHarness }, (it) => {
  it("passes the packed-package reference across every required gate", async ({ run }) => {
    const runId = await trialRunId("battery-reference-1")
    const result = await run({ ...input, runId, adapterId: "reference" })
    const outcome = decodeTrialOutcomeSync(result.output)

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: 1 })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(outcome.requiredGates).toHaveLength(6)
    expect(outcome.requiredGates.map((gate) => gate.id)).toEqual([
      "battery.public-package-boundary",
      "battery.stream-events",
      "battery.scoped-subscription-lifecycle",
      "battery.listener-cleanup",
      "battery.failure-preservation",
      "battery.layer-provisioning",
    ])
    expect(outcome.requiredGates.every((gate) => gate.result === "pass")).toBe(true)
    expect(result.session.events).toHaveLength(4)
  })

  it("rejects the no-op stream", async ({ run }) => {
    const runId = await trialRunId("battery-noop-1")
    const result = await run({ ...input, runId, adapterId: "noop" })
    const outcome = decodeTrialOutcomeSync(result.output)

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(
      outcome.requiredGates.filter((gate) => gate.result === "fail").map((gate) => gate.id),
    ).toEqual([
      "battery.public-package-boundary",
      "battery.stream-events",
      "battery.scoped-subscription-lifecycle",
      "battery.listener-cleanup",
      "battery.failure-preservation",
      "battery.layer-provisioning",
    ])
  })

  it("rejects a fixed stream that bypasses the scoped Battery layer", async ({ run }) => {
    const runId = await trialRunId("battery-broken-1")
    const result = await run({ ...input, runId, adapterId: "broken" })
    const outcome = decodeTrialOutcomeSync(result.output)
    const lifecycle = outcome.requiredGates.find(
      (gate) => gate.id === "battery.scoped-subscription-lifecycle",
    )
    const provisioning = outcome.requiredGates.find(
      (gate) => gate.id === "battery.layer-provisioning",
    )

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(lifecycle?.result).toBe("fail")
    expect(provisioning?.result).toBe("fail")
    expect(
      outcome.requiredGates.filter((gate) => gate.result === "pass").map((gate) => gate.id),
    ).toEqual(["battery.stream-events"])
    expect(
      outcome.requiredGates.filter((gate) => gate.result === "fail").map((gate) => gate.id),
    ).toEqual([
      "battery.public-package-boundary",
      "battery.scoped-subscription-lifecycle",
      "battery.listener-cleanup",
      "battery.failure-preservation",
      "battery.layer-provisioning",
    ])
  })
})
