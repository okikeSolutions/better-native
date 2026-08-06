import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Config from "../Config.ts"
import * as Domain from "../Domain.ts"
import * as Isolation from "../security/Isolation.ts"
import * as Submission from "../security/Submission.ts"
import * as Verifier from "../security/Verifier.ts"
import * as TaskModel from "./TaskModel.ts"
import * as Workspace from "./Workspace.ts"

const TaskDefinition = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  taskType: Schema.Literal("synthetic-effect"),
  id: Domain.TaskId,
  version: Domain.TaskVersion,
  allowedSubmissionPaths: Schema.Array(Domain.TaskRelativePath),
  entrypoint: Domain.TaskRelativePath,
  exportName: Domain.ExportName,
})

const Expected = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expectedValue: Schema.String,
})

const Observation = Schema.Union([
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal("effect"),
    value: Schema.Json,
  }),
  Schema.Struct({ schemaVersion: Schema.Literal(1), kind: Schema.Literal("not-effect") }),
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal("effect-failure"),
    failureCategory: Schema.optional(Schema.Literal("module-load")),
  }),
])

/** Loaded synthetic foundation task. */
interface TaskData extends TaskModel.TaskBase<Schema.Schema.Type<typeof TaskDefinition>> {
  readonly taskType: "synthetic-effect"
  readonly expectedValue: string
}

/** Loaded synthetic foundation task. */
export type Task = TaskData &
  Pick<TaskModel.ReviewedTask<Schema.Schema.Type<typeof TaskDefinition>>, "verify">

/** Trusted result produced after observing one synthetic candidate. */
export interface VerificationResult {
  readonly passed: boolean
  readonly rationale: string
  readonly observation: unknown
  readonly isolation: Isolation.IsolationObservation
}

/** Loads and validates the repository-owned synthetic task bundle. */
export const load = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const path = yield* Path.Path
  const fixturePath = Domain.TaskRelativePath.make("src/Greeting.ts")
  const files = yield* Workspace.readTaskFiles(
    path.join(config.repositoryRoot, "evals", "tasks", "synthetic-effect"),
    fixturePath,
  )
  const definition = yield* Workspace.decodeJson(
    TaskDefinition,
    files.encodedDefinition,
    "invalid-synthetic-task-definition",
  )
  const expected = yield* Workspace.decodeJson(
    Expected,
    files.encodedExpected,
    "invalid-synthetic-grader-data",
  )
  const evaluatorBundle = yield* Workspace.readEvaluatorBundle(
    "synthetic-effect",
    "Synthetic.ts",
    "effect",
  )
  const task = {
    taskType: "synthetic-effect",
    root: files.root,
    instruction: files.instruction,
    fixtureFiles: [{ path: fixturePath, content: files.fixtureSource }],
    expectedValue: expected.expectedValue,
    definition,
    publicPackages: [],
    packedPackage: null,
    evaluatorBundle,
  } satisfies TaskData
  return {
    ...task,
    verify: (submission: Submission.Submission) => verify(task, submission),
  } satisfies Task
})

/** Rebuilds a pristine workspace and verifies the synthetic Effect observation. */
export const verifySubmission = (task: TaskData, untrustedSubmission: Submission.Submission) =>
  Effect.scoped(
    Effect.gen(function* () {
      const submission = yield* Submission.validateSubmission(untrustedSubmission, {
        allowedPaths: new Set(task.definition.allowedSubmissionPaths),
        maxFiles: 4,
        maxFileBytes: 64 * 1024,
        maxTotalBytes: 128 * 1024,
      })
      const workspace = yield* Workspace.materializeCandidate(task, submission)
      const isolation = yield* Isolation.Isolation
      const isolated = yield* isolation.observe({
        workspace: workspace.root,
        entrypoint: task.definition.entrypoint,
        exportName: task.definition.exportName,
      })
      const parsed = yield* Verifier.parseObservation(isolated)
      const observation = yield* Schema.decodeUnknownEffect(Observation)(parsed).pipe(
        Effect.mapError(
          () => new Verifier.VerificationInvalid({ reason: "invalid-synthetic-observation" }),
        ),
      )
      const passed = Match.value(observation).pipe(
        Match.when({ kind: "effect", value: task.expectedValue }, () => true),
        Match.when({ kind: "effect" }, () => false),
        Match.when({ kind: "not-effect" }, () => false),
        Match.when({ kind: "effect-failure" }, () => false),
        Match.exhaustive,
      )
      const decision = TaskModel.gateDecision(
        passed,
        "The exported value is an Effect that succeeds with the expected observation.",
        "The candidate did not export an Effect with the expected observation.",
        observation.kind === "effect-failure" && observation.failureCategory === "module-load"
          ? "module-load"
          : "scenario",
      )
      return {
        passed,
        rationale: decision.rationale,
        observation,
        isolation: isolated,
      } satisfies VerificationResult
    }),
  )

/** Verifies a synthetic submission and maps it to reporter-facing gates. */
export const verify = (task: TaskData, submission: Submission.Submission) =>
  verifySubmission(task, submission).pipe(
    Effect.map(
      (result) =>
        ({
          observation: result.observation,
          toolName: "verify_synthetic_effect",
          gates: [
            {
              id: Domain.GateId.make("synthetic.effect-observation"),
              required: true,
              result: TaskModel.gateResult(result.passed),
              rationale: result.rationale,
            },
          ],
        }) satisfies TaskModel.TrialVerification,
    ),
  )
