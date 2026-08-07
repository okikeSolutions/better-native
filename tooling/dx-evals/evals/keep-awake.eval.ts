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
  taskId: "keep-awake",
  taskVersion: "1",
} as const
const suiteRunId =
  process.env.BETTER_NATIVE_EVAL_RUN_ID ??
  RunIdentity.makeDefaultCampaignId(Date.now(), crypto.randomUUID())
const trialRunId = (caseName: string) =>
  dxEvalRuntime.runPromise(RunIdentity.makeTrialRunId(suiteRunId, caseName))

describeEval("Keep Awake", { harness: dxHarness }, (it) => {
  it("passes the scoped packed-package reference across every required gate", async ({ run }) => {
    const runId = await trialRunId("keep-awake-reference-1")
    const result = await run({ ...input, runId, adapterId: "reference" })
    const outcome = decodeTrialOutcomeSync(result.output)

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: 1 })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(outcome.requiredGates.map((gate) => gate.id)).toEqual([
      "keep-awake.public-package-boundary",
      "keep-awake.active-lease",
      "keep-awake.scoped-cleanup",
      "keep-awake.unavailable-error",
      "keep-awake.activation-failure",
      "keep-awake.layer-provisioning",
    ])
    expect(outcome.requiredGates.every((gate) => gate.result === "pass")).toBe(true)
    expect(result.session.events).toHaveLength(4)
  })

  it("rejects the no-op Effect", async ({ run }) => {
    const runId = await trialRunId("keep-awake-noop-1")
    const result = await run({ ...input, runId, adapterId: "noop" })
    const outcome = decodeTrialOutcomeSync(result.output)

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(outcome.requiredGates.every((gate) => gate.result === "fail")).toBe(true)
  })

  it("rejects an unscoped lease that leaks on interruption", async ({ run }) => {
    const runId = await trialRunId("keep-awake-broken-1")
    const result = await run({ ...input, runId, adapterId: "broken" })
    const outcome = decodeTrialOutcomeSync(result.output)

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(
      outcome.requiredGates.find((gate) => gate.id === "keep-awake.active-lease")?.result,
    ).toBe("pass")
    expect(
      outcome.requiredGates.find((gate) => gate.id === "keep-awake.scoped-cleanup")?.result,
    ).toBe("fail")
  })
})
