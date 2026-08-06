import { createJudge, type JsonValue } from "vitest-evals"
import * as Match from "effect/Match"
import * as Domain from "../Domain.ts"

/**
 * Deterministic report-facing score for the task's trusted required gates.
 *
 * The verifier remains the authority: this judge only projects its signed gate outcomes into the
 * Vitest Evals judge surface so reports can compare scores and show failed-gate rationales.
 */
export const RequiredGateJudge = createJudge<Domain.TrialInputEncoded, JsonValue>(
  "RequiredGateJudge",
  ({ output }) => {
    const outcome = Domain.decodeTrialOutcomeSync(output)
    const requiredGates = outcome.requiredGates.filter((gate) => gate.required)
    const passedGates = requiredGates.filter((gate) => gate.result === "pass")
    const failedGates = requiredGates.filter((gate) => gate.result !== "pass")
    const score =
      outcome.infrastructureStatus === "valid" && requiredGates.length > 0
        ? passedGates.length / requiredGates.length
        : 0
    const rationale = Match.value(outcome.infrastructureStatus).pipe(
      Match.when(
        "infrastructure-error",
        () => "Infrastructure invalid; the task was not evaluated.",
      ),
      Match.when("valid", () =>
        Match.value(failedGates.length === 0).pipe(
          Match.when(true, () => `All ${requiredGates.length} required gates passed.`),
          Match.when(
            false,
            () => `${passedGates.length}/${requiredGates.length} required gates passed.`,
          ),
          Match.exhaustive,
        ),
      ),
      Match.exhaustive,
    )

    return {
      score,
      metadata: {
        rationale,
        output: {
          infrastructureStatus: outcome.infrastructureStatus,
          taskSuccess: outcome.taskSuccess,
          failureEvidence: outcome.failureEvidence.map((finding) => ({
            category: finding.category,
            phase: finding.phase,
            ...(finding.gateId === undefined ? {} : { gateId: finding.gateId }),
          })),
          passedGateIds: passedGates.map((gate) => gate.id),
          failedGates: failedGates.map((gate) => ({
            id: gate.id,
            result: gate.result,
            rationale: gate.rationale,
            ...(gate.failureCategory === undefined
              ? {}
              : { failureCategory: gate.failureCategory }),
          })),
        },
      },
    }
  },
)
