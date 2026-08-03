import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { CaseResult, TestCaseId, TestSourceId } from "../Domain.ts"

export interface ExpectedExternalRun {
  readonly sourceId: TestSourceId
  readonly staticCaseIds: ReadonlyArray<TestCaseId>
}

export class ExternalRunProtocolError extends Data.TaggedError("ExternalRunProtocolError")<{
  readonly reason: string
}> {}

export const validate = Effect.fn("ExternalRunProtocol.validate")(function* (
  expected: ExpectedExternalRun,
  results: ReadonlyArray<CaseResult>,
) {
  if (results.length === 0) {
    return yield* new ExternalRunProtocolError({ reason: "external runner produced no cases" })
  }
  const resultIds = results.map(({ caseId }) => caseId)
  const observed = new Set(resultIds)
  if (observed.size !== resultIds.length) {
    return yield* new ExternalRunProtocolError({
      reason: "external runner produced duplicate cases",
    })
  }
  const outside = resultIds.filter((caseId) => !caseId.startsWith(`${expected.sourceId}#`))
  const missing = expected.staticCaseIds.filter((caseId) => !observed.has(caseId))
  if (outside.length > 0 || missing.length > 0) {
    return yield* new ExternalRunProtocolError({
      reason: `external case coverage does not close (missing: ${missing.join(", ") || "none"}; outside: ${outside.join(", ") || "none"})`,
    })
  }
  const unsuccessful = results.filter(
    ({ outcome }) => outcome._tag !== "passed" && outcome._tag !== "skipped",
  )
  if (unsuccessful.length > 0) {
    return yield* new ExternalRunProtocolError({
      reason: `${unsuccessful.length} external case(s) failed, timed out, crashed, or were not run`,
    })
  }
  return results
})
