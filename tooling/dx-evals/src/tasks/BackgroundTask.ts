import * as Effect from "effect/Effect"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Config from "../Config.ts"
import * as Domain from "../Domain.ts"
import * as Isolation from "../security/Isolation.ts"
import * as Submission from "../security/Submission.ts"
import * as Verifier from "../security/Verifier.ts"
import * as SourcePolicy from "./SourcePolicy.ts"
import * as TaskModel from "./TaskModel.ts"
import * as Workspace from "./Workspace.ts"

const TaskDefinition = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  taskType: Schema.Literal("background-task"),
  id: Domain.TaskId,
  version: Domain.TaskVersion,
  allowedSubmissionPaths: Schema.Array(Domain.TaskRelativePath),
  entrypoint: Domain.TaskRelativePath,
  exportName: Domain.ExportName,
  publicPackages: Schema.Array(Schema.String),
})

const ScenarioId = Schema.Literals(["available", "restricted"])
const Expected = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  scenarios: Schema.Array(Schema.Struct({ id: ScenarioId })),
})

interface TaskData extends TaskModel.TaskBase<Schema.Schema.Type<typeof TaskDefinition>> {
  readonly taskType: "background-task"
  readonly scenarios: Schema.Schema.Type<typeof Expected>["scenarios"]
}

/** Loaded public Background Task composition task. */
export type Task = TaskData &
  Pick<TaskModel.ReviewedTask<Schema.Schema.Type<typeof TaskDefinition>>, "verify">

/** Per-gate result of verifying persistent Background Task consumption. */
export interface VerificationResult {
  readonly passed: boolean
  readonly packageBoundaryPassed: boolean
  readonly eagerDefinitionPassed: boolean
  readonly handlerResultPassed: boolean
  readonly availableRegistrationPassed: boolean
  readonly restrictedOutcomePassed: boolean
  readonly packageDigest: Domain.Sha256Digest
  readonly packageDigests: Readonly<Record<string, Domain.Sha256Digest>>
  readonly observations: ReadonlyArray<unknown>
  readonly isolation: ReadonlyArray<Isolation.IsolationObservation>
  readonly moduleLoadFailed: boolean
}

const Observation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("background-task-consumer"),
  scenario: ScenarioId,
  effectIsValid: Schema.Boolean,
  effectSucceeded: Schema.Boolean,
  value: Schema.optional(Schema.Json),
  defineCalls: Domain.NonNegativeInteger,
  handlerResult: Schema.optional(Schema.Json),
  registerCalls: Domain.NonNegativeInteger,
  registeredName: Schema.optional(Schema.String),
  minimumInterval: Schema.optional(Schema.Number),
  statusCalls: Domain.NonNegativeInteger,
  failureCategory: Schema.optional(Schema.Literal("module-load")),
})
type Observation = Schema.Schema.Type<typeof Observation>

const decodeObservation = (value: unknown) =>
  Schema.decodeUnknownEffect(Observation)(value).pipe(
    Effect.mapError(
      () =>
        new Verifier.VerificationInvalid({
          reason: "invalid-background-task-observation",
        }),
    ),
  )

/** Loads and validates the repository-owned Background Task bundle. */
export const load = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const path = yield* Path.Path
  const fixturePath = Domain.TaskRelativePath.make("src/ObserveTask.ts")
  const files = yield* Workspace.readTaskFiles(
    path.join(config.repositoryRoot, "evals", "tasks", "background-task"),
    fixturePath,
  )
  const definition = yield* Workspace.decodeJson(
    TaskDefinition,
    files.encodedDefinition,
    "invalid-background-task-task-definition",
  )
  if (
    definition.publicPackages.length !== 2 ||
    definition.publicPackages[0] !== "@better-native/background-task" ||
    definition.publicPackages[1] !== "@better-native/task-manager"
  ) {
    return yield* new Workspace.TaskBundleInvalid({
      reason: "invalid-background-task-public-package-set",
    })
  }
  const expected = yield* Workspace.decodeJson(
    Expected,
    files.encodedExpected,
    "invalid-background-task-grader-data",
  )
  yield* Workspace.validateScenarioIds(
    expected.scenarios.map(({ id }) => id),
    ["available", "restricted"],
    "incomplete-background-task-scenarios",
  )
  const task = {
    taskType: "background-task" as const,
    root: files.root,
    instruction: files.instruction,
    fixtureFiles: [{ path: fixturePath, content: files.fixtureSource }],
    scenarios: expected.scenarios,
    definition,
    publicPackages: definition.publicPackages,
    packedPackage: {
      taskName: "background-task",
      packageDirectory: "background-task",
      packageName: "@better-native/background-task",
      nativeDouble: "expo-background-task",
      companionPackages: [
        {
          taskName: "task-manager",
          packageDirectory: "task-manager",
          packageName: "@better-native/task-manager",
          nativeDouble: "expo-task-manager",
        },
      ],
    },
    evaluatorBundle: yield* Workspace.readEvaluatorBundle(
      "background-task",
      "BackgroundTask.ts",
      "background-task",
    ),
  } satisfies TaskData
  return {
    ...task,
    verify: (submission: Submission.Submission) => verify(task, submission),
  } satisfies Task
})

/** Verifies public package composition in isolated available and restricted environments. */
export const verifySubmission = (task: TaskData, untrustedSubmission: Submission.Submission) =>
  Effect.scoped(
    Effect.gen(function* () {
      const submission = yield* Submission.validateSubmission(untrustedSubmission, {
        allowedPaths: new Set(task.definition.allowedSubmissionPaths),
        maxFiles: 4,
        maxFileBytes: 64 * 1024,
        maxTotalBytes: 128 * 1024,
      })
      const candidateSource =
        submission.entries.find((entry) => entry.path === task.definition.entrypoint)?.content ??
        task.fixtureFiles[0]!.content
      const workspace = yield* Workspace.materializeCandidate(task, submission)
      const isolation = yield* Isolation.Isolation
      const results = yield* Effect.forEach(task.scenarios, ({ id }) =>
        isolation
          .observe({
            workspace: workspace.root,
            entrypoint: task.definition.entrypoint,
            exportName: task.definition.exportName,
            runner: "observe-background-task.ts",
            runnerArguments: [id],
          })
          .pipe(
            Effect.flatMap((isolated) =>
              Verifier.parseObservation(isolated).pipe(
                Effect.flatMap(decodeObservation),
                Effect.map((observation) => ({ isolated, observation })),
              ),
            ),
          ),
      )
      const byScenario = new Map(
        results.map(({ observation }) => [observation.scenario, observation]),
      )
      const available = byScenario.get("available")
      const restricted = byScenario.get("restricted")
      const packageBoundaryPassed =
        workspace.packageSource === "packed-public-package" &&
        workspace.packageDigest !== null &&
        workspace.packageDigests.has("@better-native/background-task") &&
        workspace.packageDigests.has("@better-native/task-manager") &&
        SourcePolicy.checkPublicConsumerSet(candidateSource, [
          "@better-native/background-task",
          "@better-native/task-manager",
        ]).passed
      const eagerDefinitionPassed = results.every(
        ({ observation }) => observation.defineCalls === 1,
      )
      const handlerResultPassed = results.every(
        ({ observation }) => observation.handlerResult === 1,
      )
      const availableRegistrationPassed =
        available?.effectIsValid === true &&
        available.effectSucceeded &&
        available.value === "registered" &&
        available.statusCalls === 1 &&
        available.registerCalls === 1 &&
        available.registeredName === "dx.eval.background" &&
        available.minimumInterval === 15
      const restrictedOutcomePassed =
        restricted?.effectIsValid === true &&
        restricted.effectSucceeded &&
        restricted.value === "restricted" &&
        restricted.statusCalls === 1 &&
        restricted.registerCalls === 0
      if (workspace.packageDigest === null) {
        return yield* new Verifier.VerificationInvalid({
          reason: "missing-packed-background-task-digest",
        })
      }
      return {
        passed:
          packageBoundaryPassed &&
          eagerDefinitionPassed &&
          handlerResultPassed &&
          availableRegistrationPassed &&
          restrictedOutcomePassed,
        packageBoundaryPassed,
        eagerDefinitionPassed,
        handlerResultPassed,
        availableRegistrationPassed,
        restrictedOutcomePassed,
        packageDigest: workspace.packageDigest,
        packageDigests: Object.fromEntries(workspace.packageDigests),
        observations: results.map(({ observation }) => observation),
        isolation: results.map(({ isolated }) => isolated),
        moduleLoadFailed: results.some(
          ({ observation }) => observation.failureCategory === "module-load",
        ),
      } satisfies VerificationResult
    }),
  )

/** Maps Background Task verification outcomes to reviewed reporter gates. */
export const verify = (task: TaskData, submission: Submission.Submission) =>
  verifySubmission(task, submission).pipe(
    Effect.map((result) => {
      const category: Domain.FailureCategory = result.moduleLoadFailed ? "module-load" : "scenario"
      const gates: ReadonlyArray<
        readonly [string, boolean, string, string, Domain.FailureCategory]
      > = [
        [
          "public-package-boundary",
          result.packageBoundaryPassed,
          "The candidate consumed both packed public Better Native packages.",
          "The candidate escaped the packed public package boundary.",
          "source-policy",
        ],
        [
          "module-scope-definition",
          result.eagerDefinitionPassed,
          "The background handler was defined synchronously at module scope.",
          "The background handler was not defined synchronously at module scope.",
          category,
        ],
        [
          "handler-result",
          result.handlerResultPassed,
          "The Effect handler reported BackgroundTaskResult.Success.",
          "The Effect handler did not report BackgroundTaskResult.Success.",
          category,
        ],
        [
          "available-registration",
          result.availableRegistrationPassed,
          "Available native state produced one persistent registration with reviewed options.",
          "Available native state did not produce the expected persistent registration.",
          category,
        ],
        [
          "restricted-outcome",
          result.restrictedOutcomePassed,
          "Restricted native state remained an explicit no-op outcome.",
          "Restricted native state was hidden or attempted native registration.",
          category,
        ],
      ]
      return {
        observation: {
          packageDigest: result.packageDigest,
          packageDigests: result.packageDigests,
          scenarios: result.observations,
        },
        toolName: "verify_background_task_effect",
        gates: gates.map(([id, passed, success, failure, failureCategory]) => ({
          id: Domain.GateId.make(`background-task.${id}`),
          required: true,
          ...TaskModel.gateDecision(passed, success, failure, failureCategory),
        })),
      } satisfies TaskModel.TrialVerification
    }),
  )
