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
  taskType: Schema.Literal("sqlite"),
  id: Domain.TaskId,
  version: Domain.TaskVersion,
  allowedSubmissionPaths: Schema.Array(Domain.TaskRelativePath),
  entrypoint: Domain.TaskRelativePath,
  exportName: Domain.ExportName,
  publicPackages: Schema.Array(Schema.String),
})

/** Controlled SQLite scenario understood by the trusted runner. */
export const ScenarioId = Schema.Literals(["round-trip", "query-failure"])
/** Controlled SQLite scenario identity. */
export type ScenarioId = Schema.Schema.Type<typeof ScenarioId>

/** Validates that the SQLite grader defines each reviewed scenario exactly once. */
export const validateScenarioIds = (ids: ReadonlyArray<ScenarioId>) =>
  Workspace.validateScenarioIds(ids, ScenarioId.literals, "incomplete-sqlite-scenarios")

const Expected = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  scenarios: Schema.Array(Schema.Struct({ id: ScenarioId })),
})

type TaskData = TaskModel.TaskBase<Schema.Schema.Type<typeof TaskDefinition>> & {
  readonly taskType: "sqlite"
  readonly scenarios: Schema.Schema.Type<typeof Expected>["scenarios"]
}

/** Loaded public SQLite transaction task. */
export type Task = TaskModel.ReviewedTask<TaskData>

/** Per-gate result of verifying SQLite consumption against controlled native scenarios. */
export interface VerificationResult {
  readonly passed: boolean
  readonly packageBoundaryPassed: boolean
  readonly roundTripPassed: boolean
  readonly transactionPassed: boolean
  readonly cleanupPassed: boolean
  readonly queryFailurePassed: boolean
  readonly layerProvisioningPassed: boolean
  readonly packageDigest: Domain.Sha256Digest
  readonly observations: ReadonlyArray<unknown>
  readonly isolation: ReadonlyArray<Isolation.IsolationObservation>
  readonly moduleLoadFailed: boolean
}

const Operation = Schema.Literals([
  "begin",
  "commit",
  "rollback",
  "create",
  "insert",
  "select",
  "other",
])
const Observation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("sqlite-consumer"),
  effectIsValid: Schema.Boolean,
  effectSucceeded: Schema.Boolean,
  value: Schema.optional(Schema.Json),
  failureTag: Schema.optional(Schema.Json),
  openCalls: Domain.NonNegativeInteger,
  closeCalls: Domain.NonNegativeInteger,
  operations: Schema.Array(Operation),
  parametersMatched: Schema.Boolean,
  failureCategory: Schema.optional(Schema.Literal("module-load")),
})
type Observation = Schema.Schema.Type<typeof Observation>

const decodeObservation = (value: unknown) =>
  Schema.decodeUnknownEffect(Observation)(value).pipe(
    Effect.mapError(
      () => new Verifier.VerificationInvalid({ reason: "invalid-sqlite-observation" }),
    ),
  )

/** Loads and validates the repository-owned SQLite task bundle. */
export const load = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const path = yield* Path.Path
  const fixturePath = Domain.TaskRelativePath.make("src/ReadTemporaryValue.ts")
  const files = yield* Workspace.readTaskFiles(
    path.join(config.repositoryRoot, "evals", "tasks", "sqlite"),
    fixturePath,
  )
  const definition = yield* Workspace.decodeJson(
    TaskDefinition,
    files.encodedDefinition,
    "invalid-sqlite-task-definition",
  )
  if (
    definition.publicPackages.length !== 1 ||
    definition.publicPackages[0] !== "@better-native/sqlite"
  ) {
    return yield* new Workspace.TaskBundleInvalid({ reason: "invalid-sqlite-public-package-set" })
  }
  const expected = yield* Workspace.decodeJson(
    Expected,
    files.encodedExpected,
    "invalid-sqlite-grader-data",
  )
  yield* validateScenarioIds(expected.scenarios.map((scenario) => scenario.id))
  const task = {
    taskType: "sqlite",
    root: files.root,
    instruction: files.instruction,
    fixtureFiles: [{ path: fixturePath, content: files.fixtureSource }],
    scenarios: expected.scenarios,
    definition,
    publicPackages: definition.publicPackages,
    packedPackage: {
      taskName: "sqlite",
      packageDirectory: "sqlite",
      packageName: "@better-native/sqlite",
      nativeDouble: "expo-sqlite",
    },
    evaluatorBundle: yield* Workspace.readEvaluatorBundle("sqlite", "Sqlite.ts", "sqlite"),
  } satisfies TaskData
  return {
    ...task,
    verify: (submission: Submission.Submission) => verify(task, submission),
  } satisfies Task
})

/** Verifies resource-safe SQLite consumption through the packed public package. */
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
      const results = yield* Effect.forEach(
        task.scenarios,
        (scenario) =>
          Effect.gen(function* () {
            const isolated = yield* isolation.observe({
              workspace: workspace.root,
              entrypoint: task.definition.entrypoint,
              exportName: task.definition.exportName,
              runner: "observe-sqlite.ts",
              runnerArguments: [scenario.id],
            })
            return {
              scenario,
              isolated,
              observation: yield* decodeObservation(yield* Verifier.parseObservation(isolated)),
            }
          }),
        { concurrency: 1 },
      )
      const byScenario = (id: ScenarioId) =>
        results.find((result) => result.scenario.id === id)?.observation
      const roundTrip = byScenario("round-trip")
      const queryFailure = byScenario("query-failure")
      const roundTripPassed =
        roundTrip?.effectIsValid === true &&
        roundTrip.effectSucceeded &&
        roundTrip.value === "controlled-value" &&
        roundTrip.parametersMatched &&
        roundTrip.operations.join(",") === "begin,create,insert,select,commit"
      const transactionPassed =
        roundTrip?.operations.join(",") === "begin,create,insert,select,commit" &&
        queryFailure?.operations.join(",") === "begin,create,insert,select,rollback"
      const cleanupPassed = results.every(
        ({ observation }) => observation.openCalls === 1 && observation.closeCalls === 1,
      )
      const queryFailurePassed =
        queryFailure?.effectIsValid === true &&
        !queryFailure.effectSucceeded &&
        queryFailure.failureTag === "SqlError" &&
        queryFailure.parametersMatched
      const layerProvisioningPassed = results.every(
        ({ observation }) =>
          observation.effectIsValid && observation.parametersMatched && observation.openCalls === 1,
      )
      const packageBoundaryPassed =
        workspace.packageSource === "packed-public-package" &&
        workspace.packageDigest !== null &&
        SourcePolicy.checkPublicConsumer(candidateSource, "@better-native/sqlite").passed
      const moduleLoadFailed = results.some(
        ({ observation }) => observation.failureCategory === "module-load",
      )
      if (workspace.packageDigest === null) {
        return yield* new Verifier.VerificationInvalid({ reason: "missing-packed-sqlite-digest" })
      }
      return {
        passed:
          packageBoundaryPassed &&
          roundTripPassed &&
          transactionPassed &&
          cleanupPassed &&
          queryFailurePassed &&
          layerProvisioningPassed,
        packageBoundaryPassed,
        roundTripPassed,
        transactionPassed,
        cleanupPassed,
        queryFailurePassed,
        layerProvisioningPassed,
        packageDigest: workspace.packageDigest,
        observations: results.map(({ observation }) => observation),
        isolation: results.map(({ isolated }) => isolated),
        moduleLoadFailed,
      } satisfies VerificationResult
    }),
  )

/** Verifies SQLite and maps its safety dimensions to reporter-facing gates. */
export const verify = (task: TaskData, submission: Submission.Submission) =>
  verifySubmission(task, submission).pipe(
    Effect.map((result) => {
      const decisions: ReadonlyArray<
        readonly [string, boolean, string, string, Domain.FailureCategory]
      > = [
        [
          "public-package-boundary",
          result.packageBoundaryPassed,
          "The candidate consumed the packed public SQLite package without internal imports.",
          "The candidate did not stay within the packed public SQLite package boundary.",
          "source-policy",
        ],
        [
          "round-trip",
          result.roundTripPassed,
          "The Effect created, inserted, and read the controlled value.",
          "The exported Effect did not complete the controlled SQLite round trip.",
          result.moduleLoadFailed ? "module-load" : "scenario",
        ],
        [
          "transaction",
          result.transactionPassed,
          "The transaction committed on success and rolled back the failed query.",
          "SQLite operations did not observe the reviewed transaction boundaries.",
          result.moduleLoadFailed ? "module-load" : "scenario",
        ],
        [
          "scoped-cleanup",
          result.cleanupPassed,
          "Each scoped client connection was closed exactly once.",
          "The SQLite client connection was not released by scope finalization.",
          result.moduleLoadFailed ? "module-load" : "scenario",
        ],
        [
          "query-failure",
          result.queryFailurePassed,
          "The failed query retained the typed SqlError channel.",
          "The failed query did not retain the declared SqlError channel.",
          result.moduleLoadFailed ? "module-load" : "scenario",
        ],
        [
          "layer-provisioning",
          result.layerProvisioningPassed,
          "The SQLite layer opened the reviewed database with parameterized SQL.",
          "The Effect did not provision the reviewed SQLite layer or use parameterized SQL.",
          result.moduleLoadFailed ? "module-load" : "scenario",
        ],
      ]
      return {
        observation: { packageDigest: result.packageDigest, scenarios: result.observations },
        toolName: "verify_sqlite_effect",
        gates: decisions.map(([id, passed, success, failure, category]) => ({
          id: Domain.GateId.make(`sqlite.${id}`),
          required: true,
          ...TaskModel.gateDecision(passed, success, failure, category),
        })),
      } satisfies TaskModel.TrialVerification
    }),
  )
