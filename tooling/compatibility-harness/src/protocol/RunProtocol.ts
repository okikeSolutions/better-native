import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { AppRunSummary, InfrastructureOutcome, Mode, TestSourceId } from "../Domain.ts"

/** Identity and source scope that an app summary must close over. */
export interface ExpectedRun {
  readonly runId: string
  readonly buildId: string
  readonly mode: Mode
  readonly sourceId: TestSourceId
}

/** Rejects summaries that cannot be trusted as evidence for the requested run. */
export class RunProtocolError extends Data.TaggedError("RunProtocolError")<{
  readonly reason: string
}> {}

/**
 * Finds duplicate identifiers while preserving deterministic error ordering.
 *
 * @remarks
 * A `Set` is used for membership and a second `Set` prevents reporting the same
 * duplicate more than once. Sorting makes protocol failures stable across runs.
 *
 * @param values - Identifiers collected from an app summary.
 * @returns Sorted identifiers that occurred at least twice.
 */
const duplicates = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const duplicate = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value)
    seen.add(value)
  }
  return [...duplicate].toSorted()
}

/**
 * Closes an in-app summary over the exact run request before it becomes evidence.
 *
 * @param expected - Requested run, build, mode, and source identity.
 * @param summary - Application-provided run summary.
 * @returns The unchanged summary after protocol closure succeeds.
 * @throws {@link RunProtocolError} for foreign, duplicate, empty, or invalid case results.
 */
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

/**
 * Validates a summary covering every source in a native execution cohort.
 *
 * @param expected - Requested run identity and complete cohort source IDs.
 * @param summary - Application-provided batch summary.
 * @returns The unchanged summary after every cohort source is closed.
 * @throws {@link RunProtocolError} for missing, foreign, duplicate, or invalid results.
 */
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
 *
 * @returns The successful infrastructure outcome used after protocol validation.
 */
export const completedInfrastructure = (): InfrastructureOutcome => ({
  _tag: "succeeded",
})
