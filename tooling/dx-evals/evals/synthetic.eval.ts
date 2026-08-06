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
  taskId: "synthetic-effect",
  taskVersion: "1",
} as const
const suiteRunId =
  process.env.BETTER_NATIVE_EVAL_RUN_ID ??
  RunIdentity.makeDefaultCampaignId(Date.now(), crypto.randomUUID())
const trialRunId = (caseName: string) =>
  dxEvalRuntime.runPromise(RunIdentity.makeTrialRunId(suiteRunId, caseName))

describeEval("DX eval synthetic proof", { harness: dxHarness }, (it) => {
  it("normalizes a passing reference run exactly once", async ({ run }) => {
    const runId = await trialRunId("synthetic-reference-1")
    const result = await run({
      ...input,
      runId,
      adapterId: "reference",
    })
    const outcome = decodeTrialOutcomeSync(result.output)

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: 1 })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(outcome.requiredGates).toHaveLength(1)
    expect(outcome.requiredGates[0]?.id).toBe("synthetic.effect-observation")
    expect(outcome.requiredGates[0]?.result).toBe("pass")
    expect(result.session.events).toHaveLength(4)
    expect(result.session.events[2]?.type).toBe("tool_call")
    expect(result.session.events[3]?.type).toBe("tool_result")
  })

  for (const adapterId of ["noop", "broken"] as const) {
    it(`retains a failing ${adapterId} outcome after one run`, async ({ run }) => {
      const runId = await trialRunId(`synthetic-${adapterId}-1`)
      const result = await run({
        ...input,
        runId,
        adapterId,
      })
      const outcome = decodeTrialOutcomeSync(result.output)

      await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
      expect(getHarnessInvocationCount(runId)).toBe(1)
      expect(outcome.infrastructureStatus).toBe("valid")
      expect(outcome.requiredGates).toHaveLength(1)
      expect(outcome.requiredGates[0]?.id).toBe("synthetic.effect-observation")
      expect(outcome.requiredGates[0]?.result).toBe("fail")
      expect(outcome.requiredGates[0]?.rationale).toBe(
        "The candidate did not export an Effect with the expected observation.",
      )
      expect(result.session.events).toHaveLength(4)
    })
  }
})
