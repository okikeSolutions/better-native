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
  taskType: Schema.Literal("notifications"),
  id: Domain.TaskId,
  version: Domain.TaskVersion,
  allowedSubmissionPaths: Schema.Array(Domain.TaskRelativePath),
  entrypoint: Domain.TaskRelativePath,
  exportName: Domain.ExportName,
  publicPackages: Schema.Array(Schema.String),
})
const Expected = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  scenarios: Schema.Array(Schema.Struct({ id: Schema.Literal("received") })),
})
interface TaskData extends TaskModel.TaskBase<Schema.Schema.Type<typeof TaskDefinition>> {
  readonly taskType: "notifications"
  readonly scenarios: Schema.Schema.Type<typeof Expected>["scenarios"]
}
export type Task = TaskData &
  Pick<TaskModel.ReviewedTask<Schema.Schema.Type<typeof TaskDefinition>>, "verify">

const Observation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("notifications-consumer"),
  effectIsValid: Schema.Boolean,
  effectSucceeded: Schema.Boolean,
  value: Schema.optional(Schema.Json),
  listenerCalls: Domain.NonNegativeInteger,
  removeCalls: Domain.NonNegativeInteger,
  failureCategory: Schema.optional(Schema.Literal("module-load")),
})
const decodeObservation = (value: unknown) =>
  Schema.decodeUnknownEffect(Observation)(value).pipe(
    Effect.mapError(
      () => new Verifier.VerificationInvalid({ reason: "invalid-notifications-observation" }),
    ),
  )

export const load = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const path = yield* Path.Path
  const fixturePath = Domain.TaskRelativePath.make("src/ObserveNotifications.ts")
  const files = yield* Workspace.readTaskFiles(
    path.join(config.repositoryRoot, "evals", "tasks", "notifications"),
    fixturePath,
  )
  const definition = yield* Workspace.decodeJson(
    TaskDefinition,
    files.encodedDefinition,
    "invalid-notifications-task-definition",
  )
  if (
    definition.publicPackages.length !== 1 ||
    definition.publicPackages[0] !== "@better-native/notifications"
  ) {
    return yield* new Workspace.TaskBundleInvalid({
      reason: "invalid-notifications-public-package-set",
    })
  }
  const expected = yield* Workspace.decodeJson(
    Expected,
    files.encodedExpected,
    "invalid-notifications-grader-data",
  )
  const task = {
    taskType: "notifications" as const,
    root: files.root,
    instruction: files.instruction,
    fixtureFiles: [{ path: fixturePath, content: files.fixtureSource }],
    scenarios: expected.scenarios,
    definition,
    publicPackages: definition.publicPackages,
    packedPackage: {
      taskName: "notifications",
      packageDirectory: "notifications",
      packageName: "@better-native/notifications",
      nativeDouble: "expo-notifications",
    },
    evaluatorBundle: yield* Workspace.readEvaluatorBundle(
      "notifications",
      "Notifications.ts",
      "notifications",
    ),
  } satisfies TaskData
  return {
    ...task,
    verify: (submission: Submission.Submission) => verify(task, submission),
  } satisfies Task
})

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
        runner: "observe-notifications.ts",
      })
      const observation = yield* decodeObservation(yield* Verifier.parseObservation(isolated))
      if (workspace.packageDigest === null) {
        return yield* new Verifier.VerificationInvalid({
          reason: "missing-packed-notifications-digest",
        })
      }
      return {
        packageBoundaryPassed:
          workspace.packageSource === "packed-public-package" &&
          SourcePolicy.checkPublicConsumer(candidateSource, "@better-native/notifications").passed,
        streamPassed:
          observation.effectIsValid &&
          observation.effectSucceeded &&
          observation.value === "notification-1" &&
          observation.listenerCalls === 1,
        cleanupPassed: observation.removeCalls === 1,
        packageDigest: workspace.packageDigest,
        observation,
      }
    }),
  )

export const verify = (task: TaskData, submission: Submission.Submission) =>
  verifySubmission(task, submission).pipe(
    Effect.map((result) => ({
      observation: { packageDigest: result.packageDigest, scenario: result.observation },
      toolName: "verify_notifications_consumer",
      gates: [
        {
          id: Domain.GateId.make("notifications.public-package-boundary"),
          required: true,
          ...TaskModel.gateDecision(
            result.packageBoundaryPassed,
            "The candidate consumed the packed public Notifications package.",
            "The candidate escaped the packed public Notifications package boundary.",
            "source-policy",
          ),
        },
        {
          id: Domain.GateId.make("notifications.received-stream"),
          required: true,
          ...TaskModel.gateDecision(
            result.streamPassed,
            "The candidate consumed exactly one notification from the Effect Stream.",
            "The candidate did not consume the required notification Stream value.",
            "scenario",
          ),
        },
        {
          id: Domain.GateId.make("notifications.scoped-cleanup"),
          required: true,
          ...TaskModel.gateDecision(
            result.cleanupPassed,
            "Stream completion removed the native Notifications subscription.",
            "Stream completion leaked the native Notifications subscription.",
            "scenario",
          ),
        },
      ],
    })),
  )
