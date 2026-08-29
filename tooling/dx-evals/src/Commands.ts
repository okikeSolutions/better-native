import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import * as Console from "effect/Console"
import * as Crypto from "effect/Crypto"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as AgentProfiles from "./agent/AgentProfiles.ts"
import * as OpenRouterAgent from "./agent/OpenRouterAgent.ts"
import * as ProviderCompatibility from "./agent/ProviderCompatibility.ts"
import * as Campaigns from "./campaign/Campaigns.ts"
import * as Config from "./Config.ts"
import * as Domain from "./Domain.ts"
import * as CampaignSummary from "./reporting/CampaignSummary.ts"
import * as ReportSelection from "./reporting/ReportSelection.ts"
import * as ReportSmoke from "./reporting/ReportSmoke.ts"

/** Failure raised when a trusted eval subprocess exits unsuccessfully. */
export class EvalProcessFailure extends Data.TaggedError("EvalProcessFailure")<{
  readonly operation: string
  readonly exitCode?: number
  readonly cause?: unknown
}> {}

/** Failure raised when paid execution was not explicitly confirmed. */
export class PaidExecutionNotConfirmed extends Data.TaggedError("PaidExecutionNotConfirmed") {}

/** Failure raised when a paid provider probe was not explicitly confirmed. */
export class PaidProbeNotConfirmed extends Data.TaggedError("PaidProbeNotConfirmed") {}

/** Failure raised when an explicit provider does not pass the compatibility probe. */
export class ProviderCompatibilityRejected extends Data.TaggedError(
  "ProviderCompatibilityRejected",
)<{ readonly reason: ProviderCompatibility.Quarantined["reason"] }> {}

const executeProcess = (
  operation: string,
  args: ReadonlyArray<string>,
  env?: Readonly<Record<string, string>>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const config = yield* Config.DxEvalConfig
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(config.bunExecutable, args, {
          cwd: config.repositoryRoot,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          ...(env === undefined ? {} : { env, extendEnv: true }),
        }),
      )
      const exitCode = Number(yield* handle.exitCode)
      return exitCode
    }).pipe(
      Effect.mapError((cause) =>
        Match.value(cause).pipe(
          Match.when(
            (error: unknown): error is EvalProcessFailure => error instanceof EvalProcessFailure,
            (error) => error,
          ),
          Match.orElse((error) => new EvalProcessFailure({ operation, cause: error })),
        ),
      ),
    ),
  )

const runProcess = (
  operation: string,
  args: ReadonlyArray<string>,
  env?: Readonly<Record<string, string>>,
) =>
  executeProcess(operation, args, env).pipe(
    Effect.flatMap((exitCode) =>
      exitCode === 0 ? Effect.void : Effect.fail(new EvalProcessFailure({ operation, exitCode })),
    ),
  )

const campaignFlag = Flag.choice("campaign", Campaigns.campaignNames).pipe(
  Flag.withDefault("checkpoint-5-diagnostic"),
  Flag.withDescription("Select a reviewed campaign definition"),
)
const taskFlag = Flag.choice("task", [
  "all",
  "network",
  "battery",
  "keep-awake",
  "secure-store",
] as const).pipe(
  Flag.withDefault("all"),
  Flag.withDescription("Run all campaign tasks or one diagnostic subset"),
)
const validationTaskFlag = Flag.choice("task", [
  "all",
  "background-task",
  "battery",
  "clipboard",
  "keep-awake",
  "location",
  "network",
  "notifications",
  "secure-store",
  "sqlite",
  "task-manager",
] as const).pipe(
  Flag.withDefault("all"),
  Flag.withDescription("Validate every deterministic task or one capability"),
)
const campaignProfileFlag = Flag.choice("profile", Campaigns.profileSelections).pipe(
  Flag.withDefault("all"),
  Flag.withDescription("Run every reviewed profile or one explicit profile"),
)

const resolvePlan = (
  campaign: string,
  task: Campaigns.TaskSelection,
  profile: Campaigns.ProfileSelection,
) =>
  Campaigns.get(Domain.CampaignId.make(campaign)).pipe(
    Effect.flatMap((definition) => Campaigns.makePlan(definition, task, profile)),
  )

/** Prints the exact reviewed trial matrix without reading credentials or making provider calls. */
export const plan = Command.make(
  "plan",
  { campaign: campaignFlag, task: taskFlag, profile: campaignProfileFlag },
  Effect.fn("DxEvals.Command.plan")(function* ({ campaign, profile, task }) {
    const resolved = yield* resolvePlan(campaign, task, profile)
    yield* Console.log(
      JSON.stringify(
        {
          ...resolved,
          credentialRequirements: {
            dedicatedOpenRouterKey: true,
            serverSpendingLimitUsdAtMost: Campaigns.reviewedMaximumKeyLimitUsd,
            campaignRemainingAllowanceAtLeast: resolved.maximumCampaignCostUsd,
          },
        },
        null,
        2,
      ),
    )
  }),
).pipe(Command.withDescription("Print a reviewed eval campaign without making paid requests"))

/** Runs secretless deterministic controls through Vitest Evals. */
export const validate = Command.make("validate", { task: validationTaskFlag }, ({ task }) =>
  runProcess(
    "validate deterministic evals",
    [
      "x",
      "turbo",
      "run",
      "evals:validate",
      "--filter",
      "@better-native/dx-evals",
      "--concurrency=90%",
    ],
    task === "all" ? undefined : { BETTER_NATIVE_EVAL_TASK: task },
  ),
).pipe(Command.withDescription("Run deterministic reference, no-op, and broken controls"))

/** Validates deterministic JSON metadata and the ephemeral local report UI. */
export const smoke = Command.make("smoke", {}, () => ReportSmoke.run).pipe(
  Command.withDescription("Run deterministic evals and probe the local report UI"),
)

/** Serves an explicitly scoped set of locally retained Vitest Evals reports. */
export const report = Command.make(
  "report",
  {
    latest: Flag.boolean("latest").pipe(
      Flag.withDescription("Serve only the latest retained report (the default)"),
      Flag.withDefault(false),
    ),
    campaign: Flag.string("campaign").pipe(
      Flag.optional,
      Flag.withDescription("Serve reports whose run ID belongs to this campaign"),
    ),
    all: Flag.boolean("all").pipe(
      Flag.withDescription("Serve every retained report, including historical campaigns"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("DxEvals.Command.report")(function* ({ all, campaign, latest }) {
    const scope = yield* ReportSelection.resolveScope({
      all,
      campaign,
      latest,
    })
    const reports = yield* ReportSelection.discover(scope)
    yield* runProcess("serve eval report", [
      "x",
      "vitest-evals",
      "serve",
      ...reports.map(({ reportPath }) => reportPath),
    ])
  }),
).pipe(Command.withDescription("Serve scoped local Vitest Evals reports (latest by default)"))

/** Runs one reviewed, bounded multi-turn provider probe without starting a task trial. */
export const probeProvider = Command.make(
  "probe-provider",
  {
    profile: Flag.choice("profile", AgentProfiles.reviewedProfileIds).pipe(
      Flag.withDefault("deepseek-v4-flash-0731"),
      Flag.withDescription("Select the reviewed profile to probe"),
    ),
    confirmPaid: Flag.boolean("confirm-paid").pipe(
      Flag.withDescription("Confirm the single bounded provider request"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("DxEvals.Command.probeProvider")(function* ({ confirmPaid, profile: profileId }) {
    if (!confirmPaid) return yield* new PaidProbeNotConfirmed()
    yield* OpenRouterAgent.requireCredential
    const profiles = yield* AgentProfiles.AgentProfiles
    const profile = yield* profiles.get(Domain.AgentProfileId.make(profileId))
    const result = yield* ProviderCompatibility.probeCodingProtocol(profile)
    yield* Console.log(JSON.stringify(result, null, 2))
    if (result.status === "quarantined") {
      return yield* new ProviderCompatibilityRejected({
        reason: result.reason,
      })
    }
  }),
).pipe(
  Command.withDescription(
    "Probe one explicit provider with a bounded, non-retrying coding protocol",
  ),
)

/** Executes a reviewed paid campaign through one serialized Vitest invocation. */
export const run = Command.make(
  "run",
  {
    campaign: campaignFlag,
    task: taskFlag,
    profile: campaignProfileFlag,
    confirmPaid: Flag.boolean("confirm-paid").pipe(
      Flag.withDescription("Confirm that the reviewed maximum cost may be spent"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("DxEvals.Command.run")(function* ({ campaign, confirmPaid, profile, task }) {
    const resolved = yield* resolvePlan(campaign, task, profile)
    yield* Console.log(JSON.stringify(resolved, null, 2))
    if (!confirmPaid) return yield* new PaidExecutionNotConfirmed()
    yield* OpenRouterAgent.requireCredential

    const crypto = yield* Crypto.Crypto
    const config = yield* Config.DxEvalConfig
    const runId = Domain.RunId.make(`${campaign}-${yield* crypto.randomUUIDv4}`)
    const campaignAnnotations = {
      component: "dx-evals",
      campaignId: resolved.campaignId,
      campaignRunId: runId,
      taskSelection: resolved.taskSelection,
      profileSelection: resolved.profileSelection,
      trialCount: resolved.trialCount,
      maximumCampaignCostUsd: resolved.maximumCampaignCostUsd,
    }
    yield* Effect.logInfo("Paid eval campaign started").pipe(
      Effect.annotateLogs(campaignAnnotations),
    )
    const exitCode = yield* executeProcess(
      "run paid eval campaign",
      [
        "x",
        "turbo",
        "run",
        "evals:live",
        "--filter",
        "@better-native/dx-evals",
        "--concurrency=90%",
      ],
      {
        BETTER_NATIVE_EVAL_LIVE: "1",
        BETTER_NATIVE_EVAL_CAMPAIGN: campaign,
        BETTER_NATIVE_EVAL_TASK: task,
        BETTER_NATIVE_EVAL_PROFILE: profile,
        BETTER_NATIVE_EVAL_RUN_ID: runId,
        BETTER_NATIVE_EVAL_CAMPAIGN_MAX_COST_USD: String(resolved.maximumCampaignCostUsd),
      },
    ).pipe(Effect.annotateLogs(campaignAnnotations), Effect.withLogSpan("paid-eval-campaign"))
    const reportPath = `${config.artifactsRoot}/${runId}/outputFile.json`
    const summary = yield* CampaignSummary.read(reportPath)
    yield* Console.log(JSON.stringify({ campaignSummary: summary }, null, 2))
    if (exitCode !== 0) {
      yield* Effect.logError("Paid eval campaign failed").pipe(
        Effect.annotateLogs(campaignAnnotations),
      )
      return yield* new EvalProcessFailure({
        operation: "run paid eval campaign",
        exitCode,
      })
    }
    yield* Effect.logInfo("Paid eval campaign completed").pipe(
      Effect.annotateLogs(campaignAnnotations),
    )
  }),
).pipe(Command.withDescription("Run one reviewed, serialized, paid real-agent campaign"))

/** Unified Effect CLI exposing every local and paid evaluation operation. */
export const command = Command.make("better-native-evals").pipe(
  Command.withDescription("Effect-native developer-experience evaluation harness"),
  Command.withSubcommands([validate, smoke, plan, run, probeProvider, report]),
)
