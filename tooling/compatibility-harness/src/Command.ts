import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Compatibility from "./Compatibility.ts"
import { ExpoRepository } from "./ExpoRepository.ts"
import { HarnessError } from "./HarnessError.ts"
import * as AppRegistry from "./registry/AppRegistry.ts"
import * as RunnerPlanExecution from "./registry/RunnerPlanExecution.ts"
import * as AuditPolicy from "./security/AuditPolicy.ts"
import * as Expectations from "./policy/Expectations.ts"
import * as Suites from "./suites/Suites.ts"
import { BuildPipeline } from "./supervision/BuildPipeline.ts"
import * as ExternalRunProtocol from "./supervision/ExternalRunProtocol.ts"
import {
  ExternalRunnerSupervisor,
  ExternalRunRequest,
} from "./supervision/ExternalRunnerSupervisor.ts"
import { NativeSupervisor } from "./supervision/NativeSupervisor.ts"
import { WebSupervisor } from "./supervision/WebSupervisor.ts"
import * as RunComparison from "./supervision/RunComparison.ts"

const requireSuccessfulRun = (record: {
  readonly plan: { readonly id: string }
  readonly finalInfrastructure: { readonly _tag: string }
}) =>
  record.finalInfrastructure._tag === "succeeded"
    ? Effect.void
    : Effect.fail(
        new HarnessError({
          operation: "execute compatibility run",
          cause: `${record.plan.id}: ${JSON.stringify(record.finalInfrastructure)}`,
        }),
      )

const generate = Command.make("generate", {}, Compatibility.generate).pipe(
  Command.withDescription("Generate the compatibility catalog artifact"),
)

const validate = Command.make("validate", {}, Compatibility.validate).pipe(
  Command.withDescription("Validate pinned sources and compatibility configuration"),
)

const matrix = Command.make("matrix", {}, Compatibility.matrix).pipe(
  Command.withDescription("Print the current Expo compatibility denominator"),
)

const doctor = Command.make("doctor", {}, Compatibility.doctor).pipe(
  Command.withDescription("Validate the installed Expo packages"),
)

const securityAudit = Command.make("security-audit", {}, AuditPolicy.run).pipe(
  Command.withDescription("Audit dependencies against exact reviewed Expo exception paths"),
)

const updateSurfaceLock = Command.make(
  "update-surface-lock",
  {},
  Compatibility.updateSurfaceLock,
).pipe(Command.withDescription("Review and update the pinned Expo surface lock"))

const buildMode = Flag.choice("mode", ["upstream", "candidate"] as const)
const buildPlatform = Flag.choice("platform", ["web", "ios", "android"] as const)
const buildIdFlag = Flag.string("build-id")
const timeoutMillisFlag = Flag.integer("timeout-ms").pipe(Flag.withDefault(1_200_000))
const configuredCandidateRevision = Config.string("GITHUB_SHA").pipe(
  Config.option,
  Effect.map(Option.getOrNull),
)

const candidateRevision = (mode: "upstream" | "candidate") =>
  mode === "candidate" ? configuredCandidateRevision : Effect.succeed(null)

const supervisedBuild = Command.make(
  "supervise-build",
  {
    mode: buildMode,
    platform: buildPlatform,
    buildId: buildIdFlag,
    timeoutMillis: timeoutMillisFlag,
  },
  Effect.fn("Command.superviseBuild")(function* ({ mode, platform, buildId, timeoutMillis }) {
    const repository = yield* ExpoRepository
    const builds = yield* BuildPipeline
    const revision = yield* candidateRevision(mode)
    const output = yield* builds.build({
      id: buildId,
      mode,
      platform,
      expoRevision: repository.upstreams.expo.revision,
      candidateRevision: revision,
      timeoutMillis,
    })
    yield* Console.log(JSON.stringify(output.record, null, 2))
  }),
).pipe(Command.withDescription("Create an isolated production web or Release native build"))

const webPort = Flag.integer("port").pipe(Flag.withDefault(8091))
const supervisedWeb = Command.make(
  "supervise-web",
  { mode: buildMode, buildId: buildIdFlag, timeoutMillis: timeoutMillisFlag, port: webPort },
  Effect.fn("Command.superviseWeb")(function* ({ mode, buildId, timeoutMillis, port }) {
    const repository = yield* ExpoRepository
    const builds = yield* BuildPipeline
    const web = yield* WebSupervisor
    const corpus = yield* Suites.discover()
    const revision = yield* candidateRevision(mode)
    const metadata = yield* AppRegistry.loadMetadata()
    const sourceIds = AppRegistry.runnableSourceIds(metadata, "web")
    const caseIds = AppRegistry.runnableCaseIds(metadata, "web", sourceIds)
    const build = yield* builds.build({
      id: buildId,
      mode,
      platform: "web",
      expoRevision: repository.upstreams.expo.revision,
      candidateRevision: revision,
      timeoutMillis,
    })
    const record = yield* web.run({
      id: `${buildId}-run`,
      build,
      caseIds,
      sourceIds,
      port,
      timeoutMillis,
      corpus,
    })
    yield* requireSuccessfulRun(record)
    yield* Console.log(JSON.stringify(record.finalInfrastructure))
  }),
).pipe(Command.withDescription("Build and execute a production web compatibility run"))

const probeSpecifier = Flag.string("specifier")
const probeWeb = Command.make(
  "probe-web",
  {
    mode: buildMode,
    buildId: buildIdFlag,
    timeoutMillis: timeoutMillisFlag,
    port: webPort,
    specifier: probeSpecifier,
  },
  Effect.fn("Command.probeWeb")(function* ({ mode, buildId, timeoutMillis, port, specifier }) {
    const repository = yield* ExpoRepository
    const builds = yield* BuildPipeline
    const web = yield* WebSupervisor
    const corpus = yield* Suites.discover()
    const revision = yield* candidateRevision(mode)
    const build = yield* builds.build({
      id: buildId,
      mode,
      platform: "web",
      expoRevision: repository.upstreams.expo.revision,
      candidateRevision: revision,
      timeoutMillis,
      probeSpecifier: specifier,
    })
    const discovery = yield* web.probe({
      id: `${buildId}-probe`,
      build,
      specifier,
      port,
      timeoutMillis,
      corpus,
    })
    yield* Console.log(JSON.stringify(discovery.exports[0] ?? null, null, 2))
  }),
).pipe(Command.withDescription("Build and execute one isolated opaque Expo export probe"))

const nativePlatform = Flag.choice("platform", ["ios", "android"] as const)
const recordPathFlag = Flag.string("record")
const binaryPathFlag = Flag.string("binary")
const deviceIdFlag = Flag.string("device-id")
const runIdFlag = Flag.string("run-id")
const shardIndexFlag = Flag.integer("shard-index").pipe(Flag.withDefault(0))
const shardCountFlag = Flag.integer("shard-count").pipe(Flag.withDefault(1))
const permissionStateFlag = Flag.choice("permissions", ["granted", "reset"] as const).pipe(
  Flag.withDefault("granted" as const),
)

const supervisedNative = Command.make(
  "supervise-native",
  {
    platform: nativePlatform,
    recordPath: recordPathFlag,
    binaryPath: binaryPathFlag,
    deviceId: deviceIdFlag,
    runId: runIdFlag,
    shardIndex: shardIndexFlag,
    shardCount: shardCountFlag,
    permissionState: permissionStateFlag,
    timeoutMillis: timeoutMillisFlag,
  },
  Effect.fn("Command.superviseNative")(function* ({
    platform,
    recordPath,
    binaryPath,
    deviceId,
    runId,
    shardIndex,
    shardCount,
    permissionState,
    timeoutMillis,
  }) {
    if (shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
      return yield* new HarnessError({
        operation: "validate native shard",
        cause: `shard ${shardIndex} is outside shard count ${shardCount}`,
      })
    }
    const builds = yield* BuildPipeline
    const native = yield* NativeSupervisor
    const metadata = yield* AppRegistry.loadMetadata()
    const sourceIds = AppRegistry.runnableSourceIds(metadata, platform).filter(
      (_, index) => index % shardCount === shardIndex,
    )
    const caseIds = AppRegistry.runnableCaseIds(metadata, platform, sourceIds)
    if (sourceIds.length === 0) {
      return yield* new HarnessError({
        operation: "select native shard",
        cause: `shard ${shardIndex} selected no ${platform} sources`,
      })
    }
    const build = yield* builds.load({ recordPath, binaryPath, platform })
    const record = yield* native.run({
      id: runId,
      build,
      device: {
        platform,
        id: deviceId,
        applicationId: "dev.betternative.compatibility",
        ...(platform === "android" ? { activity: ".MainActivity" } : {}),
      },
      caseIds,
      sourceIds,
      permissionState,
      timeoutMillis,
    })
    yield* requireSuccessfulRun(record)
    return yield* Console.log(JSON.stringify(record.finalInfrastructure))
  }),
).pipe(
  Command.withDescription(
    "Execute one generated Expo source shard against an imported native build",
  ),
)

const upstreamEvidenceFlag = Flag.string("upstream")
const candidateEvidenceFlag = Flag.string("candidate")
const compareRuns = Command.make(
  "compare-runs",
  { upstream: upstreamEvidenceFlag, candidate: candidateEvidenceFlag },
  Effect.fn("Command.compareRuns")(function* ({ upstream, candidate }) {
    const [upstreamRecords, candidateRecords, expectations, metadata, runnerPlans, replacements] =
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
    const platform = upstreamRecords[0]?.plan.platform ?? candidateRecords[0]?.plan.platform
    const expectedSources =
      platform === "web" || platform === "ios" || platform === "android"
        ? AppRegistry.runnableSourceIds(metadata, platform)
        : []
    const candidateTreatmentEvidence = yield* RunComparison.loadCandidateTreatmentEvidence(
      candidate,
      candidateRecords,
      replacements,
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
    yield* Console.log(JSON.stringify({ ...summary, runnerPlanCoverage }, null, 2))
    if (summary.issues.length > 0) {
      return yield* new HarnessError({
        operation: "compare compatibility runs",
        cause: summary.issues,
      })
    }
    return undefined
  }),
).pipe(
  Command.withDescription(
    "Compare complete upstream and candidate evidence sets and reject missing or unexpected behavior",
  ),
)

const externalPlan = Flag.string("plan")
const supervisedExternal = Command.make(
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
const supervisedRunnerPlans = Command.make(
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

export const command = Command.make("better-native").pipe(
  Command.withDescription("Expo compatibility harness for better-native"),
  Command.withSubcommands([
    generate,
    validate,
    matrix,
    doctor,
    securityAudit,
    updateSurfaceLock,
    supervisedBuild,
    supervisedWeb,
    probeWeb,
    supervisedNative,
    supervisedExternal,
    supervisedRunnerPlans,
    compareRuns,
  ]),
)
