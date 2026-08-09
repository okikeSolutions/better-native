import { afterAll, expect } from "vitest"
import { describeEval } from "vitest-evals"
import { decodeTrialOutcomeSync } from "../src/Domain.ts"
import { dxHarness, getHarnessInvocationCount } from "../src/Harness.ts"
import { RequiredGateJudge } from "../src/reporting/Judges.ts"
import { disposeDxEvalRuntime, dxEvalRuntime } from "../src/Runtime.ts"
import * as RunIdentity from "../src/campaign/RunIdentity.ts"

afterAll(disposeDxEvalRuntime)

const input = { schemaVersion: 1, taskId: "location", taskVersion: "1" } as const
const suiteRunId =
  process.env.BETTER_NATIVE_EVAL_RUN_ID ??
  RunIdentity.makeDefaultCampaignId(Date.now(), crypto.randomUUID())
const trialRunId = (caseName: string) =>
  dxEvalRuntime.runPromise(RunIdentity.makeTrialRunId(suiteRunId, caseName))

describeEval("Location", { harness: dxHarness }, (it) => {
  it("passes the packed scoped-position reference", async ({ run }) => {
    const runId = await trialRunId("location-reference-1")
    const result = await run({ ...input, runId, adapterId: "reference" })
    const outcome = decodeTrialOutcomeSync(result.output)
    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: 1 })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(outcome.requiredGates.map((gate) => gate.id)).toEqual([
      "location.public-package-boundary",
      "location.position-stream",
      "location.scoped-cleanup",
    ])
    expect(outcome.requiredGates.every((gate) => gate.result === "pass")).toBe(true)
  })

  it("rejects the fixed-value no-op", async ({ run }) => {
    const runId = await trialRunId("location-noop-1")
    const result = await run({ ...input, runId, adapterId: "noop" })
    const outcome = decodeTrialOutcomeSync(result.output)
    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(
      outcome.requiredGates.filter((gate) => gate.result === "fail").map((gate) => gate.id),
    ).toEqual([
      "location.public-package-boundary",
      "location.position-stream",
      "location.scoped-cleanup",
    ])
  })

  it("rejects a one-shot read that skips scoped Stream cleanup", async ({ run }) => {
    const runId = await trialRunId("location-broken-1")
    const result = await run({ ...input, runId, adapterId: "broken" })
    const outcome = decodeTrialOutcomeSync(result.output)
    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(
      outcome.requiredGates.some(
        (gate) => gate.id === "location.scoped-cleanup" && gate.result === "fail",
      ),
    ).toBe(true)
  })
})
