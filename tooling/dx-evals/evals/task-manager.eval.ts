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
  taskId: "task-manager",
  taskVersion: "1",
} as const
const suiteRunId =
  process.env.BETTER_NATIVE_EVAL_RUN_ID ??
  RunIdentity.makeDefaultCampaignId(Date.now(), crypto.randomUUID())
const trialRunId = (caseName: string) =>
  dxEvalRuntime.runPromise(RunIdentity.makeTrialRunId(suiteRunId, caseName))

describeEval("Task Manager", { harness: dxHarness }, (it) => {
  it("passes the packed module-scope task-definition reference", async ({ run }) => {
    const runId = await trialRunId("task-manager-reference-1")
    const result = await run({ ...input, runId, adapterId: "reference" })
    const outcome = decodeTrialOutcomeSync(result.output)
    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: 1 })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(outcome.requiredGates.map((gate) => gate.id)).toEqual([
      "task-manager.public-package-boundary",
      "task-manager.module-scope-definition",
      "task-manager.handler-execution",
      "task-manager.live-service",
    ])
    expect(outcome.requiredGates.every((gate) => gate.result === "pass")).toBe(true)
  })

  it("rejects a fixed-value no-op Effect", async ({ run }) => {
    const runId = await trialRunId("task-manager-noop-1")
    const result = await run({ ...input, runId, adapterId: "noop" })
    const outcome = decodeTrialOutcomeSync(result.output)
    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(
      outcome.requiredGates.filter((gate) => gate.result === "fail").map((gate) => gate.id),
    ).toEqual([
      "task-manager.public-package-boundary",
      "task-manager.module-scope-definition",
      "task-manager.handler-execution",
    ])
  })
})
