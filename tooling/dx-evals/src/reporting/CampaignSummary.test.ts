import { assert, describe, it } from "@effect/vitest"
import * as Domain from "../Domain.ts"
import * as CampaignSummary from "./CampaignSummary.ts"

const outcome = (
  infrastructureStatus: "valid" | "infrastructure-error",
  taskSuccess: boolean,
): Domain.TrialOutcome => ({
  schemaVersion: 1,
  runId: Domain.RunId.make(`summary-${infrastructureStatus}-${taskSuccess}`),
  taskId: Domain.TaskId.make("network"),
  infrastructureStatus,
  taskSuccess,
  failureEvidence: taskSuccess
    ? []
    : [
        {
          category: infrastructureStatus === "valid" ? "scenario" : "provider-protocol",
          phase: infrastructureStatus === "valid" ? "verification" : "provider",
        },
      ],
  requiredGates: [],
  transcript: [],
  usage: {},
  publicEvidence: { status: "unavailable" },
})

describe("campaign summary", () => {
  it("keeps test execution, infrastructure validity, task success, and judge score separate", () => {
    const summary = CampaignSummary.summarize("/reports/outputFile.json", {
      testResults: [
        {
          assertionResults: [
            {
              fullName: "network / low score",
              title: "low score",
              status: "passed",
              meta: {
                eval: { scores: [{ name: "RequiredGateJudge", score: 0.2 }] },
                harness: { run: { output: outcome("valid", false) } },
              },
            },
            {
              fullName: "network / provider failure",
              title: "provider failure",
              status: "failed",
              meta: {
                eval: { scores: [{ name: "RequiredGateJudge", score: 0 }] },
                harness: { run: { output: outcome("infrastructure-error", false) } },
              },
            },
          ],
        },
      ],
    })

    assert.deepStrictEqual(summary.trials[0], {
      name: "network / low score",
      testExecution: "completed",
      infrastructure: "valid",
      task: "failure",
      judgeScore: 0.2,
      failureCategories: ["scenario"],
    })
    assert.deepStrictEqual(summary.trials[1], {
      name: "network / provider failure",
      testExecution: "failed",
      infrastructure: "error",
      task: "not-evaluated",
      judgeScore: 0,
      failureCategories: ["provider-protocol"],
    })
    assert.strictEqual(summary.taskSuccessCount, 0)
    assert.strictEqual(summary.taskFailureCount, 1)
    assert.strictEqual(summary.infrastructureErrorCount, 1)
    assert.strictEqual(summary.infrastructureUnavailableCount, 0)
    assert.strictEqual(summary.taskNotEvaluatedCount, 1)
    assert.notInclude(JSON.stringify(summary.trials[0]), '"task":"passed"')
  })
})
