import { afterAll, expect } from "vitest"
import { describeEval } from "vitest-evals"
import * as Schema from "effect/Schema"
import * as Campaigns from "../src/campaign/Campaigns.ts"
import * as Domain from "../src/Domain.ts"
import { decodeTrialOutcomeSync } from "../src/Domain.ts"
import { dxHarness, getHarnessInvocationCount } from "../src/Harness.ts"
import { RequiredGateJudge } from "../src/reporting/Judges.ts"
import { disposeDxEvalRuntime, dxEvalRuntime } from "../src/Runtime.ts"
import * as RunIdentity from "../src/campaign/RunIdentity.ts"

afterAll(disposeDxEvalRuntime)

const liveEnabled = process.env.BETTER_NATIVE_EVAL_LIVE === "1"
const campaignId = Schema.decodeUnknownSync(Domain.CampaignId)(
  process.env.BETTER_NATIVE_EVAL_CAMPAIGN ?? Campaigns.defaultCampaignId,
)
const taskSelection = Schema.decodeUnknownSync(Campaigns.TaskSelection)(
  process.env.BETTER_NATIVE_EVAL_TASK ?? "all",
)
const profileSelection = Schema.decodeUnknownSync(Campaigns.ProfileSelection)(
  process.env.BETTER_NATIVE_EVAL_PROFILE ?? "all",
)
const campaign = await dxEvalRuntime.runPromise(Campaigns.get(campaignId))
const trials = Campaigns.selectTrials(campaign, taskSelection, profileSelection)
const suiteRunId =
  process.env.BETTER_NATIVE_EVAL_RUN_ID ??
  RunIdentity.makeDefaultCampaignId(Date.now(), crypto.randomUUID())
const trialRunId = (caseName: string) =>
  dxEvalRuntime.runPromise(RunIdentity.makeTrialRunId(suiteRunId, caseName))

describeEval(
  `${campaign.id} real-agent campaign`,
  { harness: dxHarness, skipIf: () => !liveEnabled },
  (it) => {
    for (const trial of trials) {
      const caseName = Campaigns.trialCaseName(trial)
      it(`runs ${caseName}`, async ({ run }) => {
        const runId = await trialRunId(caseName)
        const result = await run({
          schemaVersion: 1,
          runId,
          taskId: trial.taskId,
          taskVersion: trial.taskVersion,
          adapterId: "openrouter-coding-agent",
          agentProfileId: trial.agentProfileId,
        })
        const outcome = decodeTrialOutcomeSync(result.output)

        await expect(result).toSatisfyJudge(RequiredGateJudge, {
          threshold: null,
        })
        expect(getHarnessInvocationCount(runId)).toBe(1)
        expect(outcome.infrastructureStatus).toBe("valid")
        expect(outcome.requiredGates.length).toBeGreaterThan(0)
        expect(
          outcome.requiredGates.every(
            (gate) =>
              gate.required && gate.result !== "unknown" && gate.result !== "infrastructure-error",
          ),
        ).toBe(true)
        expect(outcome.agentExitReason).toBeDefined()
        expect(outcome.usage.model).toBeDefined()
        expect(outcome.usage.turns).toBeGreaterThan(0)
        expect(outcome.usage.inputTokens).toBeGreaterThan(0)
        expect(outcome.usage.outputTokens).toBeGreaterThan(0)
        expect(outcome.usage.totalTokens).toBeGreaterThan(0)
        expect(outcome.usage.costUsd).toBeTypeOf("number")
        expect(outcome.usage.costUsd).toBeGreaterThan(0)
        expect(outcome.publicEvidence.status).toBe("process-authenticated")
        if (outcome.publicEvidence.status !== "process-authenticated") {
          throw new Error("paid trial did not publish process-authenticated evidence")
        }
        expect(outcome.publicEvidence.digest).toMatch(/^[a-f0-9]{64}$/)
        expect(outcome.transcript.length).toBeGreaterThan(0)
        expect(outcome.requiredGates.every((gate) => gate.rationale.length > 0)).toBe(true)
      })
    }
  },
)
