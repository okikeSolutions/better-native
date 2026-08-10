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
  taskType: Schema.Literal("location"),
  id: Domain.TaskId,
  version: Domain.TaskVersion,
  allowedSubmissionPaths: Schema.Array(Domain.TaskRelativePath),
  entrypoint: Domain.TaskRelativePath,
  exportName: Domain.ExportName,
  publicPackages: Schema.Array(Schema.String),
})

const Expected = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  scenarios: Schema.Array(Schema.Struct({ id: Schema.Literal("position") })),
})

type TaskData = TaskModel.TaskBase<Schema.Schema.Type<typeof TaskDefinition>> & {
  readonly taskType: "location"
  readonly scenarios: Schema.Schema.Type<typeof Expected>["scenarios"]
}

/** Loaded public Location Stream task. */
export type Task = TaskModel.ReviewedTask<TaskData>

const Observation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("location-consumer"),
  effectIsValid: Schema.Boolean,
  effectSucceeded: Schema.Boolean,
  value: Schema.optional(Schema.Json),
  watchCalls: Domain.NonNegativeInteger,
  removeCalls: Domain.NonNegativeInteger,
  failureCategory: Schema.optional(Schema.Literal("module-load")),
})

const decodeObservation = (value: unknown) =>
  Schema.decodeUnknownEffect(Observation)(value).pipe(
    Effect.mapError(
      () => new Verifier.VerificationInvalid({ reason: "invalid-location-observation" }),
    ),
  )

/** Loads and validates the repository-owned Location task bundle. */
export const load = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const path = yield* Path.Path
  const fixturePath = Domain.TaskRelativePath.make("src/ObserveLocation.ts")
  const files = yield* Workspace.readTaskFiles(
    path.join(config.repositoryRoot, "evals", "tasks", "location"),
    fixturePath,
  )
  const definition = yield* Workspace.decodeJson(
    TaskDefinition,
    files.encodedDefinition,
    "invalid-location-task-definition",
  )
  if (
    definition.publicPackages.length !== 1 ||
    definition.publicPackages[0] !== "@better-native/location"
  ) {
    return yield* new Workspace.TaskBundleInvalid({ reason: "invalid-location-public-package-set" })
  }
  const expected = yield* Workspace.decodeJson(
    Expected,
    files.encodedExpected,
    "invalid-location-grader-data",
  )
  if (expected.scenarios.length !== 1 || expected.scenarios[0]?.id !== "position") {
    return yield* new Workspace.TaskBundleInvalid({ reason: "incomplete-location-scenarios" })
  }
  const task = {
    taskType: "location" as const,
    root: files.root,
    instruction: files.instruction,
    fixtureFiles: [{ path: fixturePath, content: files.fixtureSource }],
    scenarios: expected.scenarios,
    definition,
    publicPackages: definition.publicPackages,
    packedPackage: {
      taskName: "location",
      packageDirectory: "location",
      packageName: "@better-native/location",
      nativeDouble: "expo-location",
    },
    evaluatorBundle: yield* Workspace.readEvaluatorBundle("location", "Location.ts", "location"),
  } satisfies TaskData
  return {
    ...task,
    verify: (submission: Submission.Submission) => verify(task, submission),
  } satisfies Task
})

/** Verifies scoped Stream consumption from the packed public package. */
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
        runner: "observe-location.ts",
      })
      const observation = yield* decodeObservation(yield* Verifier.parseObservation(isolated))
      if (workspace.packageDigest === null) {
        return yield* new Verifier.VerificationInvalid({ reason: "missing-packed-location-digest" })
      }
      const packageBoundaryPassed =
        workspace.packageSource === "packed-public-package" &&
        SourcePolicy.checkPublicConsumer(candidateSource, "@better-native/location").passed
      const streamPassed =
        observation.effectIsValid &&
        observation.effectSucceeded &&
        observation.value === 48.2 &&
        observation.watchCalls === 1
      const cleanupPassed = observation.removeCalls === 1
      return {
        packageBoundaryPassed,
        streamPassed,
        cleanupPassed,
        packageDigest: workspace.packageDigest,
        observation,
        isolated,
      }
    }),
  )

/** Maps Location verification outcomes to reviewed reporter gates. */
export const verify = (task: TaskData, submission: Submission.Submission) =>
  verifySubmission(task, submission).pipe(
    Effect.map((result) => ({
      observation: { packageDigest: result.packageDigest, scenario: result.observation },
      toolName: "verify_location_consumer",
      gates: [
        {
          id: Domain.GateId.make("location.public-package-boundary"),
          required: true,
          ...TaskModel.gateDecision(
            result.packageBoundaryPassed,
            "The candidate consumed the packed public Location package.",
            "The candidate escaped the packed public Location package boundary.",
            "source-policy",
          ),
        },
        {
          id: Domain.GateId.make("location.position-stream"),
          required: true,
          ...TaskModel.gateDecision(
            result.streamPassed,
            "The candidate consumed exactly one balanced-accuracy position from the Effect Stream.",
            "The candidate did not consume the required Location Stream value.",
            "scenario",
          ),
        },
        {
          id: Domain.GateId.make("location.scoped-cleanup"),
          required: true,
          ...TaskModel.gateDecision(
            result.cleanupPassed,
            "Stream completion removed the native Location subscription.",
            "Stream completion leaked the native Location subscription.",
            "scenario",
          ),
        },
      ],
    })),
  )
