import { afterAll, expect } from "vitest"
import { describeEval } from "vitest-evals"
import { decodeTrialOutcomeSync } from "../src/Domain.ts"
import { dxHarness, getHarnessInvocationCount } from "../src/Harness.ts"
import { RequiredGateJudge } from "../src/reporting/Judges.ts"
import { disposeDxEvalRuntime, dxEvalRuntime } from "../src/Runtime.ts"
import * as RunIdentity from "../src/campaign/RunIdentity.ts"

afterAll(disposeDxEvalRuntime)

const input = { schemaVersion: 1, taskId: "notifications", taskVersion: "1" } as const
const suiteRunId =
  process.env.BETTER_NATIVE_EVAL_RUN_ID ??
  RunIdentity.makeDefaultCampaignId(Date.now(), crypto.randomUUID())
const trialRunId = (caseName: string) =>
  dxEvalRuntime.runPromise(RunIdentity.makeTrialRunId(suiteRunId, caseName))

describeEval("Notifications", { harness: dxHarness }, (it) => {
  it("passes the packed scoped-listener reference", async ({ run }) => {
    const runId = await trialRunId("notifications-reference-1")
    const result = await run({ ...input, runId, adapterId: "reference" })
    const outcome = decodeTrialOutcomeSync(result.output)
    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: 1 })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(outcome.requiredGates.map((gate) => gate.id)).toEqual([
      "notifications.public-package-boundary",
      "notifications.received-stream",
      "notifications.scoped-cleanup",
    ])
    expect(outcome.requiredGates.every((gate) => gate.result === "pass")).toBe(true)
  })

  it("rejects the fixed-value no-op", async ({ run }) => {
    const runId = await trialRunId("notifications-noop-1")
    const result = await run({ ...input, runId, adapterId: "noop" })
    const outcome = decodeTrialOutcomeSync(result.output)
    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(outcome.requiredGates.some((gate) => gate.result === "fail")).toBe(true)
  })

  it("rejects a one-shot read that skips scoped listener cleanup", async ({ run }) => {
    const runId = await trialRunId("notifications-broken-1")
    const result = await run({ ...input, runId, adapterId: "broken" })
    const outcome = decodeTrialOutcomeSync(result.output)
    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(
      outcome.requiredGates.some(
        (gate) => gate.id === "notifications.scoped-cleanup" && gate.result === "fail",
      ),
    ).toBe(true)
  })
})
