import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
import {
  DiscoveryRecord,
  RunRecord,
  type CaseResult,
  type Expectations,
  type Platform,
  type RunRecord as RunRecordType,
  type TestCaseId,
  type TestSourceId,
} from "../Domain.ts"
import type { ReplacementManifest } from "../registry/AppRegistry.ts"

const ResolutionEvent = Schema.Struct({
  runId: Schema.String,
  buildId: Schema.String,
  ownershipFingerprint: Schema.NullOr(Schema.String),
  mode: Schema.Literals(["upstream", "candidate"]),
  specifier: Schema.String,
  replacement: Schema.NullOr(Schema.String),
  decision: Schema.Literals(["upstream", "candidate", "self-upstream", "unmanaged"]),
  outcome: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("source-file"), filePath: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("asset-files"), filePaths: Schema.Array(Schema.String) }),
    Schema.Struct({ kind: Schema.Literal("empty") }),
    Schema.Struct({ kind: Schema.Literal("failure"), name: Schema.String, message: Schema.String }),
  ]),
  resolvedTarget: Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  resolvedPackage: Schema.NullOr(Schema.String),
})

type ResolutionEventType = Schema.Schema.Type<typeof ResolutionEvent>

/** Candidate resolver observations accepted for the replacement manifest. */
export interface CandidateTreatmentEvidence {
  readonly resolvedSources: ReadonlySet<string>
  readonly issues: ReadonlyArray<string>
}

/** Aggregate result of comparing one platform's paired runs. */
export interface ComparisonSummary {
  readonly schemaVersion: 1
  readonly platform: Platform
  readonly upstreamRuns: number
  readonly candidateRuns: number
  readonly cases: number
  readonly matches: number
  readonly expectedDivergences: number
  readonly issues: ReadonlyArray<string>
}

/** Describes an unreadable, undecodable, or invalid comparison input. */
export class RunComparisonError extends Data.TaggedError("RunComparisonError")<{
  readonly operation: "read" | "decode" | "compare"
  readonly path?: string
  readonly cause: unknown
}> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Loads and decodes every run record below an evidence root.
 *
 * @param root - Upstream or candidate run-evidence directory.
 * @returns Decoded run records found below the root.
 * @throws {@link RunComparisonError} when records are missing, unreadable, or invalid.
 */
export const load = Effect.fn("RunComparison.load")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem
  const files = (yield* fs.glob("**/record.json", { root })).toSorted()
  const records: Array<RunRecordType> = []
  for (const file of files) {
    const path = file.startsWith(root) ? file : `${root}/${file}`
    const value = yield* fs.readFileString(path).pipe(
      Effect.mapError((cause) => new RunComparisonError({ operation: "read", path, cause })),
      Effect.flatMap((text) =>
        Effect.try({
          try: () => JSON.parse(text) as unknown,
          catch: (cause) => new RunComparisonError({ operation: "decode", path, cause }),
        }),
      ),
    )
    if (!isRecord(value) || !("plan" in value) || !("attempts" in value)) continue
    records.push(
      yield* Schema.decodeUnknownEffect(RunRecord)(value).pipe(
        Effect.mapError((cause) => new RunComparisonError({ operation: "decode", path, cause })),
      ),
    )
  }
  if (records.length === 0) {
    return yield* new RunComparisonError({
      operation: "read",
      path: root,
      cause: "no run records found",
    })
  }
  return records
})

/**
 * Checks whether a resolver observation agrees with its serialized outcome.
 *
 * @remarks
 * Source-file outcomes require an exact string target, while asset outcomes
 * require an exact ordered array. Empty and failed resolutions are diagnostic
 * observations, never successful candidate treatment.
 *
 * @param event - Resolution observation emitted by the instrumented app.
 * @returns Whether the observed target matches the expected resolution shape.
 */
const successfulResolution = (event: ResolutionEventType): boolean => {
  switch (event.outcome.kind) {
    case "source-file":
      return event.resolvedTarget === event.outcome.filePath
    case "asset-files":
      return (
        Array.isArray(event.resolvedTarget) &&
        JSON.stringify(event.resolvedTarget) === JSON.stringify(event.outcome.filePaths)
      )
    case "empty":
    case "failure":
      return false
  }
  return false
}

const packageName = (specifier: string): string =>
  specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!

/**
 * Verifies candidate resolution observations against the generated manifest.
 *
 * @remarks
 * Candidate treatment counts only when the observed source, target package, run,
 * build, and ownership fingerprint all agree with immutable generated inputs.
 *
 * @param root - Candidate evidence root containing discovery records.
 * @param records - Candidate run records used to bind observations to builds.
 * @param manifest - Generated and fingerprinted replacement manifest.
 * @returns Accepted resolved sources and all treatment issues.
 * @throws {@link RunComparisonError} when discovery evidence cannot be read or decoded.
 */
export const loadCandidateTreatmentEvidence = Effect.fn(
  "RunComparison.loadCandidateTreatmentEvidence",
)(function* (root: string, records: ReadonlyArray<RunRecordType>, manifest: ReplacementManifest) {
  const fs = yield* FileSystem.FileSystem
  const resolvedSources = new Set<string>()
  const issues: Array<string> = []
  const replacementBySource = new Map(
    manifest.replacements.map(({ source, target }) => [source, target] as const),
  )
  const recordsByRun = new Map<string, RunRecordType>(
    records.map((record) => [record.plan.id, record] as const),
  )
  const validate = (event: ResolutionEventType, context: string, record: RunRecordType): void => {
    if (event.buildId !== record.build.id) {
      issues.push(`${context}: resolution references foreign build ${event.buildId}`)
      return
    }
    const allowedRunIds = new Set([record.plan.id, `build-${record.build.id}`])
    if (!allowedRunIds.has(event.runId)) {
      issues.push(`${context}: resolution references foreign run ${event.runId}`)
      return
    }
    if (event.mode !== "candidate") {
      issues.push(`${context}: resolution mode is ${event.mode}, not candidate`)
      return
    }
    if (event.decision !== "candidate") return
    const target = replacementBySource.get(event.specifier)
    if (target === undefined) {
      issues.push(`${context}: candidate resolution is not declared for ${event.specifier}`)
      return
    }
    if (event.ownershipFingerprint !== manifest.ownershipFingerprint) {
      issues.push(`${context}: ownership fingerprint does not match the replacement manifest`)
      return
    }
    if (event.replacement !== target) {
      issues.push(
        `${context}: ${event.specifier} resolved through ${String(event.replacement)}, expected ${target}`,
      )
      return
    }
    if (!successfulResolution(event)) {
      issues.push(`${context}: ${event.specifier} did not resolve successfully to ${target}`)
      return
    }
    if (event.resolvedPackage !== packageName(target)) {
      issues.push(
        `${context}: ${event.specifier} resolved from ${String(event.resolvedPackage)}, expected package ${packageName(target)}`,
      )
      return
    }
    resolvedSources.add(event.specifier)
  }
  const discoveryFiles = (yield* fs.glob("**/discovery.json", { root })).toSorted()
  for (const file of discoveryFiles) {
    const path = file.startsWith(root) ? file : `${root}/${file}`
    const discovery = yield* fs.readFileString(path).pipe(
      Effect.flatMap((text) =>
        Effect.try({
          try: () => JSON.parse(text) as unknown,
          catch: (cause) => new RunComparisonError({ operation: "decode", path, cause }),
        }),
      ),
      Effect.flatMap(Schema.decodeUnknownEffect(DiscoveryRecord)),
      Effect.mapError((cause) =>
        cause instanceof RunComparisonError
          ? cause
          : new RunComparisonError({ operation: "decode", path, cause }),
      ),
    )
    const record = recordsByRun.get(discovery.runId)
    if (record === undefined) {
      issues.push(`${path}: discovery references foreign run ${discovery.runId}`)
      continue
    }
    for (const resolution of discovery.resolutions) {
      if (resolution.buildId !== record.build.id) {
        issues.push(`${path}: discovery resolution does not belong to run ${discovery.runId}`)
        continue
      }
      validate(resolution, path, record)
    }
  }
  for (const record of records) {
    for (const observation of record.attempts.flatMap(({ observations }) => observations)) {
      const marker = "BETTER_NATIVE_RESOLUTION_V1="
      const offset = observation.text.indexOf(marker)
      if (offset < 0) continue
      const event = yield* Effect.try({
        try: () => JSON.parse(observation.text.slice(offset + marker.length).trim()) as unknown,
        catch: (cause) => new RunComparisonError({ operation: "decode", cause }),
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ResolutionEvent)),
        Effect.mapError((cause) =>
          cause instanceof RunComparisonError
            ? cause
            : new RunComparisonError({ operation: "decode", cause }),
        ),
      )
      validate(event, `${record.plan.id}: observation`, record)
    }
  }
  return { resolvedSources, issues } satisfies CandidateTreatmentEvidence
})

const results = (records: ReadonlyArray<RunRecordType>) => {
  const values = new Map<TestCaseId, CaseResult>()
  const duplicates = new Set<TestCaseId>()
  for (const record of records) {
    for (const attempt of record.attempts) {
      for (const result of attempt.results) {
        if (values.has(result.caseId)) duplicates.add(result.caseId)
        values.set(result.caseId, result)
      }
    }
  }
  return { values, duplicates: [...duplicates].toSorted() }
}

const recordIssues = (record: RunRecordType): ReadonlyArray<string> => {
  const issues: Array<string> = []
  const prefix = `${record.plan.id}:`
  if (record.attempts.length === 0) issues.push(`${prefix} run has no attempts`)
  const plannedSource = record.plan.unit.sourceId
  const runtimeCases = new Set(record.runtimeDiscoveredCaseIds)
  if (runtimeCases.size !== record.runtimeDiscoveredCaseIds.length) {
    issues.push(`${prefix} runtime discovery contains duplicate cases`)
  }
  const attemptNumbers = record.attempts.map(({ attempt }) => attempt)
  const attemptIds = record.attempts.map(({ id }) => id)
  if (new Set(attemptNumbers).size !== attemptNumbers.length) {
    issues.push(`${prefix} attempts contain duplicate attempt numbers`)
  }
  if (new Set(attemptIds).size !== attemptIds.length) {
    issues.push(`${prefix} attempts contain duplicate IDs`)
  }
  const observed = new Map<string, number>()
  for (const attempt of record.attempts) {
    if (attempt.runId !== record.plan.id) {
      issues.push(`${prefix} attempt ${attempt.attempt} has the wrong run ID`)
    }
    for (const result of attempt.results) {
      if (result.runId !== record.plan.id || result.attempt !== attempt.attempt) {
        issues.push(`${prefix} ${result.caseId} has the wrong run or attempt identity`)
      }
      observed.set(result.caseId, (observed.get(result.caseId) ?? 0) + 1)
      if (!result.caseId.startsWith(`${plannedSource}#`)) {
        issues.push(`${prefix} ${result.caseId} is outside the planned source`)
      }
    }
  }
  if (observed.size === 0) issues.push(`${prefix} run produced no results`)
  for (const caseId of runtimeCases) {
    if ((observed.get(caseId) ?? 0) !== 1) {
      issues.push(`${prefix} runtime-discovered case ${caseId} was not observed exactly once`)
    }
  }
  for (const [caseId, count] of observed) {
    if (count > 1) issues.push(`${prefix} result ${caseId} was observed ${count} times`)
  }
  if (![...observed.keys()].some((caseId) => caseId.startsWith(`${plannedSource}#`))) {
    issues.push(`${prefix} planned source ${plannedSource} produced no results`)
  }
  return issues
}

const expectedTag = (expected: "fail" | "skip" | "timeout" | "crash") => {
  if (expected === "fail") return "failed"
  if (expected === "skip") return "skipped"
  return expected
}

const planIdentity = (records: ReadonlyArray<RunRecordType>) => ({
  sources: [...new Set(records.map(({ plan }) => plan.unit.sourceId))].toSorted(),
})

const buildIdentities = (records: ReadonlyArray<RunRecordType>) =>
  new Set(
    records.map(({ build }) =>
      JSON.stringify({
        id: build.id,
        configurationHash: build.configurationHash,
        bundleHash: build.bundleHash,
        nativeBinaryHash: build.nativeBinaryHash,
        expoRevision: build.expoRevision,
        candidateRevision: build.candidateRevision,
      }),
    ),
  )

/**
 * Produces the differential verdict for paired upstream and candidate evidence.
 *
 * @remarks
 * The comparison fails closed on incomplete sources, infrastructure failures,
 * unexpected outcomes, build-identity drift, and unobserved candidate replacements.
 * Reviewed expectations may explain a divergence but cannot create missing evidence.
 *
 * @param upstream - Upstream oracle run records.
 * @param candidate - Candidate run records.
 * @param expectations - Reviewed case-level expected divergences.
 * @param expectedSources - Complete source denominator for the comparison.
 * @param replacementManifest - Generated candidate replacement manifest.
 * @param candidateTreatmentEvidence - Verified resolver observations.
 * @returns Aggregate comparison counts and blocking issues.
 */
export const compare = (
  upstream: ReadonlyArray<RunRecordType>,
  candidate: ReadonlyArray<RunRecordType>,
  expectations: Expectations,
  expectedSources?: ReadonlyArray<TestSourceId>,
  replacementManifest?: ReplacementManifest,
  candidateTreatmentEvidence: CandidateTreatmentEvidence = {
    resolvedSources: new Set(),
    issues: [],
  },
): ComparisonSummary => {
  const issues: Array<string> = []
  const all = [...upstream, ...candidate]
  const platform = all[0]?.plan.platform
  if (platform === undefined) {
    throw new RunComparisonError({ operation: "compare", cause: "no run records supplied" })
  }
  if (upstream.some(({ build }) => build.mode !== "upstream")) {
    issues.push("upstream evidence contains a non-upstream build")
  }
  if (candidate.some(({ build }) => build.mode !== "candidate")) {
    issues.push("candidate evidence contains a non-candidate build")
  }
  if (
    all.some((record) => record.plan.platform !== platform || record.build.platform !== platform)
  ) {
    issues.push("evidence contains different platforms")
  }
  if (all.some((record) => record.plan.buildId !== record.build.id)) {
    issues.push("run plan build identity does not match its embedded build record")
  }
  for (const record of all) issues.push(...recordIssues(record))
  if (buildIdentities(upstream).size > 1) {
    issues.push("upstream evidence contains multiple build identities")
  }
  if (buildIdentities(candidate).size > 1) {
    issues.push("candidate evidence contains multiple build identities")
  }
  const upstreamPlan = planIdentity(upstream)
  const candidatePlan = planIdentity(candidate)
  if (JSON.stringify(upstreamPlan) !== JSON.stringify(candidatePlan)) {
    issues.push("upstream and candidate evidence cover different source-unit plans")
  }
  if (expectedSources !== undefined) {
    const observedSources = new Set(upstreamPlan.sources)
    const missingSources = expectedSources.filter((sourceId) => !observedSources.has(sourceId))
    if (missingSources.length > 0) {
      issues.push(`evidence does not cover runnable sources: ${missingSources.join(", ")}`)
    }
  }
  issues.push(...candidateTreatmentEvidence.issues)
  const missingResolutionEvidence = (replacementManifest?.replacements ?? []).filter(
    ({ source }) => !candidateTreatmentEvidence.resolvedSources.has(source),
  )
  if (missingResolutionEvidence.length > 0) {
    issues.push(
      `candidate resolution evidence is missing owned specifiers: ${missingResolutionEvidence.map(({ source }) => source).join(", ")}`,
    )
  }
  for (const record of all) {
    if (
      record.finalInfrastructure._tag !== "succeeded" &&
      record.finalInfrastructure._tag !== "runner-failed"
    ) {
      issues.push(`${record.plan.id}: infrastructure ${record.finalInfrastructure._tag}`)
    }
  }
  const revisions = new Set(all.map(({ build }) => build.expoRevision))
  if (revisions.size !== 1 || !revisions.has(expectations.expoRevision)) {
    issues.push("evidence and expectations do not share one Expo revision")
  }
  const upstreamResults = results(upstream)
  const candidateResults = results(candidate)
  if (upstreamResults.duplicates.length > 0) {
    issues.push(`duplicate upstream cases: ${upstreamResults.duplicates.join(", ")}`)
  }
  if (candidateResults.duplicates.length > 0) {
    issues.push(`duplicate candidate cases: ${candidateResults.duplicates.join(", ")}`)
  }
  const expectationMap = new Map(
    expectations.entries
      .filter(({ platforms }) => platforms.includes(platform))
      .map((entry) => [entry.caseId, entry] as const),
  )
  const caseIds = [
    ...new Set([...upstreamResults.values.keys(), ...candidateResults.values.keys()]),
  ].toSorted()
  let matches = 0
  let expectedDivergences = 0
  for (const caseId of caseIds) {
    const upstreamResult = upstreamResults.values.get(caseId)
    const candidateResult = candidateResults.values.get(caseId)
    if (upstreamResult === undefined || candidateResult === undefined) {
      issues.push(
        `${caseId}: missing ${upstreamResult === undefined ? "upstream" : "candidate"} evidence`,
      )
      continue
    }
    const upstreamTag = upstreamResult.outcome._tag
    const candidateTag = candidateResult.outcome._tag
    if (upstreamTag !== "passed") {
      if (expectationMap.has(caseId)) {
        issues.push(`${caseId}: expectation cannot apply because upstream ${upstreamTag}`)
      }
      expectationMap.delete(caseId)
      const pairedApplicabilitySkip =
        upstreamResult.outcome._tag === "skipped" &&
        upstreamResult.outcome.reason === "not selected by pinned Expo TestModules.ts" &&
        candidateResult.outcome._tag === "skipped" &&
        candidateResult.outcome.reason === upstreamResult.outcome.reason
      if (pairedApplicabilitySkip) {
        matches += 1
      } else {
        issues.push(
          `${caseId}: upstream ${upstreamTag}, candidate ${candidateTag}${upstreamTag === "skipped" && candidateTag === "skipped" ? " (non-applicability skips must match exactly)" : ""}`,
        )
      }
      continue
    }
    const expectation = expectationMap.get(caseId)
    if (expectation !== undefined) {
      const wanted = expectedTag(expectation.expected)
      if (candidateTag === wanted) {
        expectedDivergences += 1
        expectationMap.delete(caseId)
        continue
      }
      issues.push(
        `${caseId}: expected ${wanted}, observed candidate ${candidateTag}${candidateTag === "passed" ? " (stale expectation)" : ""}`,
      )
      expectationMap.delete(caseId)
      continue
    }
    if (upstreamTag !== candidateTag) {
      issues.push(`${caseId}: upstream ${upstreamTag}, candidate ${candidateTag}`)
      continue
    }
    matches += 1
  }
  for (const caseId of expectationMap.keys()) issues.push(`${caseId}: expectation has no evidence`)
  return {
    schemaVersion: 1,
    platform,
    upstreamRuns: upstream.length,
    candidateRuns: candidate.length,
    cases: caseIds.length,
    matches,
    expectedDivergences,
    issues,
  }
}
