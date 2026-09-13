import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import { ExpoRepository } from "../ExpoRepository.ts"
import {
  ComparisonEvidenceRecord,
  TestSourceId,
  type ComparisonEvidenceRecord as ComparisonEvidenceRecordType,
  type RunRecord,
  type TestSourceId as TestSourceIdType,
} from "../Domain.ts"
import { HarnessError } from "../HarnessError.ts"
import { EvidenceStore } from "../evidence/EvidenceStore.ts"
import * as AppRegistry from "../registry/AppRegistry.ts"
import * as RunnerPlanExecution from "../registry/RunnerPlanExecution.ts"
import * as Expectations from "../policy/Expectations.ts"
import * as Suites from "../suites/Suites.ts"
import * as ExternalRunProtocol from "../protocol/ExternalRunProtocol.ts"
import {
  ExternalRunnerSupervisor,
  ExternalRunRequest,
} from "../supervision/ExternalRunnerSupervisor.ts"
import * as RunComparison from "../comparison/RunComparison.ts"
import { shardCountFlag, shardIndexFlag, timeoutMillisFlag } from "./Shared.ts"

const upstreamEvidenceFlag = Flag.string("upstream")
const candidateEvidenceFlag = Flag.string("candidate")
const comparisonSourceFlag = Flag.string("source").pipe(Flag.optional)

const distinct = <A>(values: ReadonlyArray<A>): ReadonlyArray<A> => [...new Set(values)]
const nonEmpty = <A>(values: ReadonlyArray<A>): readonly [A, ...Array<A>] | undefined => {
  const first = values[0]
  return first === undefined ? undefined : [first, ...values.slice(1)]
}

const retainSuccessfulComparison = Effect.fn("Command.retainSuccessfulComparison")(function* (
  upstream: ReadonlyArray<RunRecord>,
  candidate: ReadonlyArray<RunRecord>,
  sourceIds: ReadonlyArray<TestSourceIdType>,
  summary: RunComparison.ComparisonSummary,
) {
  const evidence = yield* EvidenceStore
  const candidateRevisions = distinct(candidate.map(({ build }) => build.candidateRevision))
  const devices = distinct([...upstream, ...candidate].map(({ device }) => JSON.stringify(device)))
  const retainedSources = nonEmpty(sourceIds)
  const upstreamBuildIds = nonEmpty(distinct(upstream.map(({ build }) => build.id)))
  const candidateBuildIds = nonEmpty(distinct(candidate.map(({ build }) => build.id)))
  const upstreamRunIds = nonEmpty(upstream.map(({ plan }) => plan.id))
  const candidateRunIds = nonEmpty(candidate.map(({ plan }) => plan.id))
  if (retainedSources === undefined) {
    return yield* new HarnessError({
      operation: "retain compatibility comparison",
      cause: "comparison has no source denominator",
    })
  }
  if (
    candidateRevisions.length !== 1 ||
    candidateRevisions[0] === null ||
    candidateRevisions[0] === undefined ||
    candidateRevisions[0].length === 0
  ) {
    return yield* new HarnessError({
      operation: "retain compatibility comparison",
      cause: "candidate evidence must identify one non-empty candidate revision",
    })
  }
  if (devices.length !== 1) {
    return yield* new HarnessError({
      operation: "retain compatibility comparison",
      cause: "upstream and candidate evidence must use one identical device identity",
    })
  }
  const device = upstream[0]?.device ?? candidate[0]?.device
  const firstCandidateRun = candidate[0]?.plan.id
  if (
    device === undefined ||
    firstCandidateRun === undefined ||
    upstreamBuildIds === undefined ||
    candidateBuildIds === undefined ||
    upstreamRunIds === undefined ||
    candidateRunIds === undefined
  ) {
    return yield* new HarnessError({
      operation: "retain compatibility comparison",
      cause: "comparison has no candidate run identity",
    })
  }
  const record: ComparisonEvidenceRecordType = {
    schemaVersion: 1,
    sourceIds: retainedSources,
    platform: summary.platform,
    device,
    expoRevision: candidate[0]!.build.expoRevision,
    candidateRevision: candidateRevisions[0],
    upstreamBuildIds,
    candidateBuildIds,
    upstreamRunIds,
    candidateRunIds,
    verdict: {
      cases: summary.cases,
      matches: summary.matches,
      expectedDivergences: summary.expectedDivergences,
      issues: [],
    },
  }
  return yield* evidence.writeJson(
    "comparisons",
    `${firstCandidateRun}-comparison`,
    "record.json",
    ComparisonEvidenceRecord,
    record,
  )
})
/**
 * Compares upstream and candidate evidence and emits a differential verdict.
 *
 * @remarks
 * Missing evidence and unapproved divergences are failures, not neutral results.
 */
export const compareRuns = Command.make(
  "compare-runs",
  {
    upstream: upstreamEvidenceFlag,
    candidate: candidateEvidenceFlag,
    source: comparisonSourceFlag,
  },
  Effect.fn("Command.compareRuns")(function* ({ upstream, candidate, source }) {
    const [loadedUpstream, loadedCandidate, expectations, metadata, runnerPlans, replacements] =
      yield* Effect.all(
        [
          RunComparison.load(upstream),
          RunComparison.load(candidate),
          Expectations.load(),
          AppRegistry.loadMetadata(),
          AppRegistry.loadRunnerPlanLedger(),
          AppRegistry.loadReplacementManifest(),
        ],
        { concurrency: "unbounded" },
      )
    const selectedSource = Option.map(source, TestSourceId.make).pipe(Option.getOrUndefined)
    const upstreamRecords =
      selectedSource === undefined
        ? loadedUpstream
        : loadedUpstream.filter(({ plan }) => plan.unit.sourceId === selectedSource)
    const candidateRecords =
      selectedSource === undefined
        ? loadedCandidate
        : loadedCandidate.filter(({ plan }) => plan.unit.sourceId === selectedSource)
    const platform = upstreamRecords[0]?.plan.platform ?? candidateRecords[0]?.plan.platform
    const expectedSources = Option.match(source, {
      onNone: () =>
        Match.value(platform).pipe(
          Match.whenOr("web", "ios", "android", (supported) =>
            AppRegistry.runnableSourceIds(metadata, supported),
          ),
          Match.orElse(() => []),
        ),
      onSome: (sourceId) => [TestSourceId.make(sourceId)],
    })
    const candidateTreatmentEvidence = yield* RunComparison.loadCandidateTreatmentEvidence(
      candidate,
      candidateRecords,
      replacements,
      { ignoreForeignRuns: selectedSource !== undefined },
    )
    const summary = RunComparison.compare(
      upstreamRecords,
      candidateRecords,
      expectations,
      expectedSources,
      replacements,
      candidateTreatmentEvidence,
    )
    const runnerPlanCoverage = {
      total: runnerPlans.entries.length,
      executable: runnerPlans.entries.filter(({ status }) => status === "executable").length,
      blocked: runnerPlans.entries.filter(({ status }) => status === "blocked").length,
    }
    if (summary.issues.length > 0) {
      yield* Console.log(JSON.stringify({ ...summary, runnerPlanCoverage }, null, 2))
      return yield* new HarnessError({
        operation: "compare compatibility runs",
        cause: summary.issues,
      })
    }
    const comparisonArtifact = yield* retainSuccessfulComparison(
      upstreamRecords,
      candidateRecords,
      expectedSources,
      summary,
    )
    yield* Console.log(
      JSON.stringify({ ...summary, runnerPlanCoverage, comparisonArtifact }, null, 2),
    )
    return undefined
  }),
).pipe(
  Command.withDescription(
    "Compare complete upstream and candidate evidence sets and reject missing or unexpected behavior",
  ),
)

const externalPlan = Flag.string("plan")
/**
 * Executes one reviewed external-runner request.
 */
export const supervisedExternal = Command.make(
  "supervise-external",
  { plan: externalPlan },
  Effect.fn("Command.superviseExternal")(function* ({ plan }) {
    const repository = yield* ExpoRepository
    const supervisor = yield* ExternalRunnerSupervisor
    const request = yield* repository.readJson(plan, ExternalRunRequest)
    const corpus = yield* Suites.discover()
    const source = corpus.sources.find(({ id }) => id === request.sourceId)
    if (source === undefined) {
      return yield* new HarnessError({
        operation: "validate external runner source",
        path: plan,
        cause: `${request.sourceId} is not in the pinned Expo corpus`,
      })
    }
    if (source.runner !== request.runner) {
      return yield* new HarnessError({
        operation: "validate external runner source",
        path: plan,
        cause: `${request.sourceId} uses ${source.runner}, not ${request.runner}`,
      })
    }
    const results = yield* supervisor.run({
      ...request,
      commands: request.commands.map((command) => ({
        command: command.command,
        args: command.args,
        timeoutMillis: command.timeoutMillis,
        ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
        ...(command.env === undefined ? {} : { env: command.env }),
        ...(command.terminationGraceMillis === undefined
          ? {}
          : { terminationGraceMillis: command.terminationGraceMillis }),
      })),
    })
    yield* ExternalRunProtocol.validate(
      {
        sourceId: request.sourceId,
        staticCaseIds: corpus.cases
          .filter(({ sourceId }) => sourceId === request.sourceId)
          .map(({ id }) => id),
      },
      results,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new HarnessError({ operation: "close external runner source", path: plan, cause }),
      ),
    )
    yield* Console.log(JSON.stringify({ sourceId: request.sourceId, results: results.length }))
    return undefined
  }),
).pipe(
  Command.withDescription(
    "Execute and normalize a reviewed Node test, Jest, XCTest, Gradle, or Maestro runner plan",
  ),
)

const runnerFamily = Flag.string("runner").pipe(Flag.withDefault("all"))
const runnerReport = Flag.string("report")
/**
 * Executes a shard of generated external runner plans.
 */
export const supervisedRunnerPlans = Command.make(
  "supervise-runner-plans",
  {
    runner: runnerFamily,
    shardIndex: shardIndexFlag,
    shardCount: shardCountFlag,
    timeoutMillis: timeoutMillisFlag,
    report: runnerReport,
  },
  ({ runner, shardIndex, shardCount, timeoutMillis, report }) =>
    RunnerPlanExecution.run({ runner, shardIndex, shardCount, timeoutMillis, reportPath: report }),
).pipe(
  Command.withDescription(
    "Expand and execute a shard of the generated external runner-plan ledger with explicit not-run accounting",
  ),
)
