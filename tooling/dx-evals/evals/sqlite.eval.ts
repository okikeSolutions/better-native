import { afterAll, expect } from "vitest"
import { describeEval } from "vitest-evals"
import { decodeTrialOutcomeSync } from "../src/Domain.ts"
import { dxHarness, getHarnessInvocationCount } from "../src/Harness.ts"
import { RequiredGateJudge } from "../src/reporting/Judges.ts"
import { disposeDxEvalRuntime, dxEvalRuntime } from "../src/Runtime.ts"
import * as RunIdentity from "../src/campaign/RunIdentity.ts"

afterAll(disposeDxEvalRuntime)

const input = { schemaVersion: 1, taskId: "sqlite", taskVersion: "1" } as const
const suiteRunId =
  process.env.BETTER_NATIVE_EVAL_RUN_ID ??
  RunIdentity.makeDefaultCampaignId(Date.now(), crypto.randomUUID())
const trialRunId = (caseName: string) =>
  dxEvalRuntime.runPromise(RunIdentity.makeTrialRunId(suiteRunId, caseName))

describeEval("SQLite", { harness: dxHarness }, (it) => {
  it("passes the scoped packed-package transaction reference", async ({ run }) => {
    const runId = await trialRunId("sqlite-reference-1")
    const result = await run({ ...input, runId, adapterId: "reference" })
    const outcome = decodeTrialOutcomeSync(result.output)

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: 1 })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(outcome.requiredGates.map((gate) => gate.id)).toEqual([
      "sqlite.public-package-boundary",
      "sqlite.round-trip",
      "sqlite.transaction",
      "sqlite.scoped-cleanup",
      "sqlite.query-failure",
      "sqlite.layer-provisioning",
    ])
    expect(outcome.requiredGates.every((gate) => gate.result === "pass")).toBe(true)
    expect(result.session.events).toHaveLength(4)
  })

  it("rejects a fixed-value no-op Effect", async ({ run }) => {
    const runId = await trialRunId("sqlite-noop-1")
    const result = await run({ ...input, runId, adapterId: "noop" })
    const outcome = decodeTrialOutcomeSync(result.output)

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(outcome.requiredGates.every((gate) => gate.result === "fail")).toBe(true)
  })

  it("rejects an unbracketed implementation without a transaction", async ({ run }) => {
    const runId = await trialRunId("sqlite-broken-1")
    const result = await run({ ...input, runId, adapterId: "broken" })
    const outcome = decodeTrialOutcomeSync(result.output)

    await expect(result).toSatisfyJudge(RequiredGateJudge, { threshold: null })
    expect(getHarnessInvocationCount(runId)).toBe(1)
    expect(outcome.infrastructureStatus).toBe("valid")
    expect(
      outcome.requiredGates.filter((gate) => gate.result === "pass").map((gate) => gate.id),
    ).toEqual([
      "sqlite.public-package-boundary",
      "sqlite.scoped-cleanup",
      "sqlite.query-failure",
      "sqlite.layer-provisioning",
    ])
    expect(
      outcome.requiredGates.filter((gate) => gate.result === "fail").map((gate) => gate.id),
    ).toEqual(["sqlite.round-trip", "sqlite.transaction"])
  })
})
