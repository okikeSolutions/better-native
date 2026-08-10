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
  taskType: Schema.Literal("task-manager"),
  id: Domain.TaskId,
  version: Domain.TaskVersion,
  allowedSubmissionPaths: Schema.Array(Domain.TaskRelativePath),
  entrypoint: Domain.TaskRelativePath,
  exportName: Domain.ExportName,
  publicPackages: Schema.Array(Schema.String),
})

const Expected = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  scenarios: Schema.Array(Schema.Struct({ id: Schema.Literal("definition") })),
})

type TaskData = TaskModel.TaskBase<Schema.Schema.Type<typeof TaskDefinition>> & {
  readonly taskType: "task-manager"
  readonly scenarios: Schema.Schema.Type<typeof Expected>["scenarios"]
}

/** Loaded public Task Manager initialization task. */
export type Task = TaskModel.ReviewedTask<TaskData>

/** Per-gate result of verifying Task Manager consumption from its packed public package. */
export interface VerificationResult {
  readonly passed: boolean
  readonly packageBoundaryPassed: boolean
  readonly eagerDefinitionPassed: boolean
  readonly handlerExecutionPassed: boolean
  readonly liveServicePassed: boolean
  readonly packageDigest: Domain.Sha256Digest
  readonly observations: ReadonlyArray<unknown>
  readonly isolation: ReadonlyArray<Isolation.IsolationObservation>
  readonly moduleLoadFailed: boolean
}

const Observation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("task-manager-consumer"),
  effectIsValid: Schema.Boolean,
  effectSucceeded: Schema.Boolean,
  value: Schema.optional(Schema.Json),
  defineCalls: Domain.NonNegativeInteger,
  handlerResult: Schema.optional(Schema.Json),
  isDefinedCalls: Domain.NonNegativeInteger,
  failureCategory: Schema.optional(Schema.Literal("module-load")),
})
type Observation = Schema.Schema.Type<typeof Observation>

const decodeObservation = (value: unknown) =>
  Schema.decodeUnknownEffect(Observation)(value).pipe(
    Effect.mapError(
      () =>
        new Verifier.VerificationInvalid({
          reason: "invalid-task-manager-observation",
        }),
    ),
  )

/** Loads and validates the repository-owned Task Manager task bundle. */
export const load = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const path = yield* Path.Path
  const fixturePath = Domain.TaskRelativePath.make("src/ObserveTask.ts")
  const files = yield* Workspace.readTaskFiles(
    path.join(config.repositoryRoot, "evals", "tasks", "task-manager"),
    fixturePath,
  )
  const definition = yield* Workspace.decodeJson(
    TaskDefinition,
    files.encodedDefinition,
    "invalid-task-manager-task-definition",
  )
  if (
    definition.publicPackages.length !== 1 ||
    definition.publicPackages[0] !== "@better-native/task-manager"
  ) {
    return yield* new Workspace.TaskBundleInvalid({
      reason: "invalid-task-manager-public-package-set",
    })
  }
  const expected = yield* Workspace.decodeJson(
    Expected,
    files.encodedExpected,
    "invalid-task-manager-grader-data",
  )
  if (expected.scenarios.length !== 1 || expected.scenarios[0]?.id !== "definition") {
    return yield* new Workspace.TaskBundleInvalid({
      reason: "incomplete-task-manager-scenarios",
    })
  }
  const task = {
    taskType: "task-manager" as const,
    root: files.root,
    instruction: files.instruction,
    fixtureFiles: [{ path: fixturePath, content: files.fixtureSource }],
    scenarios: expected.scenarios,
    definition,
    publicPackages: definition.publicPackages,
    packedPackage: {
      taskName: "task-manager",
      packageDirectory: "task-manager",
      packageName: "@better-native/task-manager",
      nativeDouble: "expo-task-manager",
    },
    evaluatorBundle: yield* Workspace.readEvaluatorBundle(
      "task-manager",
      "TaskManager.ts",
      "task-manager",
    ),
  } satisfies TaskData
  return {
    ...task,
    verify: (submission: Submission.Submission) => verify(task, submission),
  } satisfies Task
})

/** Verifies module-scope task definition and live-service use in an isolated packed workspace. */
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
      const isolated = yield* isolation.observe({
        workspace: workspace.root,
        entrypoint: task.definition.entrypoint,
        exportName: task.definition.exportName,
        runner: "observe-task-manager.ts",
      })
      const observation = yield* decodeObservation(yield* Verifier.parseObservation(isolated))
      const packageBoundaryPassed =
        workspace.packageSource === "packed-public-package" &&
        workspace.packageDigest !== null &&
        candidateSource.includes("@better-native/task-manager") &&
        SourcePolicy.checkPublicConsumer(candidateSource, "@better-native/task-manager").passed
      if (workspace.packageDigest === null)
        return yield* new Verifier.VerificationInvalid({
          reason: "missing-packed-task-manager-digest",
        })
      const eagerDefinitionPassed = observation.defineCalls === 1 && observation.isDefinedCalls >= 1
      const handlerExecutionPassed = observation.handlerResult === "handled"
      const liveServicePassed =
        observation.effectIsValid && observation.effectSucceeded && observation.value === true
      return {
        passed:
          packageBoundaryPassed &&
          eagerDefinitionPassed &&
          handlerExecutionPassed &&
          liveServicePassed,
        packageBoundaryPassed,
        eagerDefinitionPassed,
        handlerExecutionPassed,
        liveServicePassed,
        packageDigest: workspace.packageDigest,
        observations: [observation],
        isolation: [isolated],
        moduleLoadFailed: observation.failureCategory === "module-load",
      } satisfies VerificationResult
    }),
  )

/** Maps Task Manager verification outcomes to reviewed reporter gates. */
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
          "The candidate consumed the packed public Task Manager package.",
          "The candidate escaped the packed public Task Manager package boundary.",
          "source-policy",
        ],
        [
          "module-scope-definition",
          result.eagerDefinitionPassed,
          "The task was defined while its module initialized.",
          "The task was not defined synchronously at module scope.",
          category,
        ],
        [
          "handler-execution",
          result.handlerExecutionPassed,
          "The defined handler ran through the supplied ManagedRuntime.",
          "The defined handler did not execute through the supplied ManagedRuntime.",
          category,
        ],
        [
          "live-service",
          result.liveServicePassed,
          "The live service observed the defined task through an Effect.",
          "The live Effect service did not observe the defined task.",
          category,
        ],
      ]
      return {
        observation: {
          packageDigest: result.packageDigest,
          scenarios: result.observations,
        },
        toolName: "verify_task_manager_effect",
        gates: gates.map(([id, passed, success, failure, failureCategory]) => ({
          id: Domain.GateId.make(`task-manager.${id}`),
          required: true,
          ...TaskModel.gateDecision(passed, success, failure, failureCategory),
        })),
      } satisfies TaskModel.TrialVerification
    }),
  )
