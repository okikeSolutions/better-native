import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { AppRunSummary, InfrastructureOutcome, Mode, TestSourceId } from "../Domain.ts"

export interface ExpectedRun {
  readonly runId: string
  readonly buildId: string
  readonly mode: Mode
  readonly sourceId: TestSourceId
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
  const runtimeIds = summary.runtimeDiscoveredCaseIds
  const duplicateRuntimeIds = duplicates(runtimeIds)
  const observed = new Set<string>(resultIds)
  const invalidRuntimeIds = runtimeIds.filter(
    (caseId) => !observed.has(caseId) || !caseId.startsWith(`${expected.sourceId}#`),
  )
  if (duplicateRuntimeIds.length > 0 || invalidRuntimeIds.length > 0) {
    return yield* new RunProtocolError({
      reason: `runtime discovery does not close (duplicates: ${duplicateRuntimeIds.join(", ") || "none"}; invalid: ${invalidRuntimeIds.join(", ") || "none"})`,
    })
  }
  const outsideSource = resultIds.filter((caseId) => !caseId.startsWith(`${expected.sourceId}#`))
  if (outsideSource.length > 0) {
    return yield* new RunProtocolError({
      reason: `in-app result contains cases outside the selected source: ${outsideSource.join(", ")}`,
    })
  }
  if (resultIds.length === 0) {
    return yield* new RunProtocolError({
      reason: `in-app result contains no cases for selected source: ${expected.sourceId}`,
    })
  }
  return summary
})

export const validateBatch = Effect.fn("RunProtocol.validateBatch")(function* (
  expected: Omit<ExpectedRun, "sourceId"> & { readonly sourceIds: ReadonlyArray<TestSourceId> },
  summary: AppRunSummary,
) {
  if (
    summary.runId !== expected.runId ||
    summary.buildId !== expected.buildId ||
    summary.mode !== expected.mode
  ) {
    return yield* new RunProtocolError({
      reason: "in-app batch result does not match the requested run, build, and mode",
    })
  }
  const resultIds = summary.results.map(({ caseId }) => caseId)
  const duplicateResults = duplicates(resultIds)
  const sourceIds = new Set(expected.sourceIds)
  const sourceOf = (caseId: string) => [...sourceIds].find((id) => caseId.startsWith(`${id}#`))
  const outsideCohort = resultIds.filter((caseId) => sourceOf(caseId) === undefined)
  const missingSources = [...sourceIds].filter(
    (sourceId) => !resultIds.some((caseId) => caseId.startsWith(`${sourceId}#`)),
  )
  const invalidResults = summary.results.filter(
    ({ runId, attempt }) => runId !== expected.runId || attempt !== 1,
  )
  const runtimeIds = summary.runtimeDiscoveredCaseIds
  const invalidRuntimeIds = runtimeIds.filter(
    (caseId) => !resultIds.includes(caseId) || sourceOf(caseId) === undefined,
  )
  if (
    duplicateResults.length > 0 ||
    outsideCohort.length > 0 ||
    missingSources.length > 0 ||
    invalidResults.length > 0 ||
    duplicates(runtimeIds).length > 0 ||
    invalidRuntimeIds.length > 0
  ) {
    return yield* new RunProtocolError({
      reason: `in-app batch result does not close over its cohort (duplicates: ${duplicateResults.join(", ") || "none"}; outside: ${outsideCohort.join(", ") || "none"}; missing: ${missingSources.join(", ") || "none"})`,
    })
  }
  return summary
})

/** A protocol-valid application summary proves that the runner completed.
 * Case outcomes are behavioral evidence and are compared separately.
 */
export const completedInfrastructure = (): InfrastructureOutcome => ({
  _tag: "succeeded",
})
