import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type {
  AppRunSummary,
  InfrastructureOutcome,
  Mode,
  TestCaseId,
  TestSourceId,
} from "../Domain.ts"

export interface ExpectedRun {
  readonly runId: string
  readonly buildId: string
  readonly mode: Mode
  readonly caseIds: ReadonlyArray<TestCaseId>
  readonly sourceIds?: ReadonlyArray<TestSourceId>
}

export class RunProtocolError extends Data.TaggedError("RunProtocolError")<{
  readonly reason: string
}> {}

const duplicates = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const duplicate = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value)
    seen.add(value)
  }
  return [...duplicate].toSorted()
}

/** Closes an in-app summary over the exact run request before it becomes evidence. */
export const validate = Effect.fn("RunProtocol.validate")(function* (
  expected: ExpectedRun,
  summary: AppRunSummary,
) {
  if (
    summary.runId !== expected.runId ||
    summary.buildId !== expected.buildId ||
    summary.mode !== expected.mode
  ) {
    return yield* new RunProtocolError({
      reason: "in-app result does not match the requested run, build, and mode",
    })
  }
  const resultIds = summary.results.map(({ caseId }) => caseId)
  const duplicateResults = duplicates(resultIds)
  if (duplicateResults.length > 0) {
    return yield* new RunProtocolError({
      reason: `in-app result contains duplicate case IDs: ${duplicateResults.join(", ")}`,
    })
  }
  if (summary.results.some((result) => result.runId !== expected.runId || result.attempt !== 1)) {
    return yield* new RunProtocolError({
      reason: "in-app case result has the wrong run ID or attempt",
    })
  }
  const sources = expected.sourceIds ?? []
  const runtimeIds = summary.runtimeDiscoveredCaseIds
  const duplicateRuntimeIds = duplicates(runtimeIds)
  const observed = new Set<string>(resultIds)
  const invalidRuntimeIds = runtimeIds.filter(
    (caseId) =>
      !observed.has(caseId) || !sources.some((sourceId) => caseId.startsWith(`${sourceId}#`)),
  )
  if (duplicateRuntimeIds.length > 0 || invalidRuntimeIds.length > 0) {
    return yield* new RunProtocolError({
      reason: `runtime discovery does not close (duplicates: ${duplicateRuntimeIds.join(", ") || "none"}; invalid: ${invalidRuntimeIds.join(", ") || "none"})`,
    })
  }
  if (expected.caseIds.length > 0 && sources.length > 0) {
    const requested = new Set<string>(expected.caseIds)
    const runtime = new Set<string>(runtimeIds)
    const missing = expected.caseIds.filter((caseId) => !observed.has(caseId))
    const unexpected = resultIds.filter(
      (caseId) =>
        !requested.has(caseId) &&
        (!runtime.has(caseId) || !sources.some((sourceId) => caseId.startsWith(`${sourceId}#`))),
    )
    if (missing.length > 0 || unexpected.length > 0) {
      return yield* new RunProtocolError({
        reason: `in-app static and runtime case coverage does not close (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`,
      })
    }
  } else if (expected.caseIds.length > 0) {
    const requested = new Set<string>(expected.caseIds)
    const missing = expected.caseIds.filter((caseId) => !observed.has(caseId))
    const unexpected = resultIds.filter((caseId) => !requested.has(caseId))
    if (missing.length > 0 || unexpected.length > 0) {
      return yield* new RunProtocolError({
        reason: `in-app case coverage does not close (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`,
      })
    }
  } else if (sources.length > 0) {
    const outsideSources = resultIds.filter(
      (caseId) => !sources.some((sourceId) => caseId.startsWith(`${sourceId}#`)),
    )
    if (outsideSources.length > 0) {
      return yield* new RunProtocolError({
        reason: `in-app result contains cases outside the requested sources: ${outsideSources.join(", ")}`,
      })
    }
    const missingSources = sources.filter(
      (sourceId) => !resultIds.some((caseId) => caseId.startsWith(`${sourceId}#`)),
    )
    if (missingSources.length > 0) {
      return yield* new RunProtocolError({
        reason: `in-app result contains no cases for requested sources: ${missingSources.join(", ")}`,
      })
    }
  }
  return summary
})

/** Converts case-level failures into a non-successful run record without losing the evidence. */
export const infrastructureOf = (summary: AppRunSummary): InfrastructureOutcome => {
  const unsuccessful = summary.results.filter(
    ({ outcome }) => outcome._tag !== "passed" && outcome._tag !== "skipped",
  )
  return unsuccessful.length === 0
    ? { _tag: "succeeded" }
    : {
        _tag: "runner-failed",
        message: `${unsuccessful.length} case(s) failed, timed out, crashed, or were not run`,
      }
}
