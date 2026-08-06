import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Domain from "../Domain.ts"

const JudgeScore = Schema.Struct({
  name: Schema.Literal("RequiredGateJudge"),
  score: Schema.Number,
})

const TrialMetadata = Schema.Struct({
  eval: Schema.Struct({ scores: Schema.Array(JudgeScore) }),
  harness: Schema.Struct({
    run: Schema.Struct({ output: Domain.TrialOutcome }),
  }),
})

const JsonReport = Schema.fromJsonString(
  Schema.Struct({
    testResults: Schema.Array(
      Schema.Struct({
        assertionResults: Schema.Array(
          Schema.Struct({
            fullName: Schema.optional(Schema.String),
            title: Schema.String,
            status: Schema.String,
            meta: Schema.Unknown,
          }),
        ),
      }),
    ),
  }),
)

export interface TrialSummary {
  readonly name: string
  readonly testExecution: "completed" | "failed" | "skipped" | "unknown"
  readonly infrastructure: "valid" | "error" | "unavailable"
  readonly task: "success" | "failure" | "not-evaluated"
  readonly judgeScore: number | null
  readonly failureCategories: ReadonlyArray<Domain.FailureCategory>
}

export interface Summary {
  readonly reportPath: string
  readonly trialCount: number
  readonly infrastructureValidCount: number
  readonly infrastructureErrorCount: number
  readonly infrastructureUnavailableCount: number
  readonly taskSuccessCount: number
  readonly taskFailureCount: number
  readonly taskNotEvaluatedCount: number
  readonly judgeScoreMean: number | null
  readonly trials: ReadonlyArray<TrialSummary>
}

/** Failure raised when a campaign report cannot be decoded into separated outcome dimensions. */
export class CampaignSummaryInvalid extends Data.TaggedError("CampaignSummaryInvalid")<{
  readonly reason: "read-report" | "decode-report"
  readonly cause?: unknown
}> {}

const testExecution = (status: string): TrialSummary["testExecution"] =>
  Match.value(status).pipe(
    Match.when("passed", () => "completed" as const),
    Match.when("failed", () => "failed" as const),
    Match.when("skipped", () => "skipped" as const),
    Match.orElse(() => "unknown" as const),
  )

const summarizeAssertion = (
  assertion: Schema.Schema.Type<
    typeof JsonReport
  >["testResults"][number]["assertionResults"][number],
): TrialSummary => {
  const decoded = Schema.decodeUnknownOption(TrialMetadata)(assertion.meta)
  if (Option.isNone(decoded)) {
    return {
      name: assertion.fullName ?? assertion.title,
      testExecution: testExecution(assertion.status),
      infrastructure: "unavailable",
      task: "not-evaluated",
      judgeScore: null,
      failureCategories: [],
    }
  }
  const outcome = decoded.value.harness.run.output
  const judge = decoded.value.eval.scores.find((score) => score.name === "RequiredGateJudge")
  const task = Match.value(outcome.infrastructureStatus).pipe(
    Match.when("infrastructure-error", () => "not-evaluated" as const),
    Match.when("valid", () =>
      Match.value(outcome.taskSuccess).pipe(
        Match.when(true, () => "success" as const),
        Match.when(false, () => "failure" as const),
        Match.exhaustive,
      ),
    ),
    Match.exhaustive,
  )
  return {
    name: assertion.fullName ?? assertion.title,
    testExecution: testExecution(assertion.status),
    infrastructure: outcome.infrastructureStatus === "valid" ? "valid" : "error",
    task,
    judgeScore: judge?.score ?? null,
    failureCategories: [...new Set(outcome.failureEvidence.map((finding) => finding.category))],
  }
}

/** Summarizes an already decoded Vitest report without conflating its three result dimensions. */
export const summarize = (
  reportPath: string,
  report: Schema.Schema.Type<typeof JsonReport>,
): Summary => {
  const trials = report.testResults.flatMap(({ assertionResults }) =>
    assertionResults.map(summarizeAssertion),
  )
  const scored = trials.flatMap((trial) => (trial.judgeScore === null ? [] : [trial.judgeScore]))
  return {
    reportPath,
    trialCount: trials.length,
    infrastructureValidCount: trials.filter((trial) => trial.infrastructure === "valid").length,
    infrastructureErrorCount: trials.filter((trial) => trial.infrastructure === "error").length,
    infrastructureUnavailableCount: trials.filter((trial) => trial.infrastructure === "unavailable")
      .length,
    taskSuccessCount: trials.filter((trial) => trial.task === "success").length,
    taskFailureCount: trials.filter((trial) => trial.task === "failure").length,
    taskNotEvaluatedCount: trials.filter((trial) => trial.task === "not-evaluated").length,
    judgeScoreMean:
      scored.length === 0 ? null : scored.reduce((sum, score) => sum + score, 0) / scored.length,
    trials,
  }
}

/** Reads and summarizes one exact campaign report. */
export const read = (reportPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const encoded = yield* fs
      .readFileString(reportPath)
      .pipe(
        Effect.mapError((cause) => new CampaignSummaryInvalid({ reason: "read-report", cause })),
      )
    const report = yield* Schema.decodeUnknownEffect(JsonReport)(encoded).pipe(
      Effect.mapError((cause) => new CampaignSummaryInvalid({ reason: "decode-report", cause })),
    )
    return summarize(reportPath, report)
  })
