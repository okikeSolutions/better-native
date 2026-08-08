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
  taskType: Schema.Literal("secure-store"),
  id: Domain.TaskId,
  version: Domain.TaskVersion,
  allowedSubmissionPaths: Schema.Array(Domain.TaskRelativePath),
  entrypoint: Domain.TaskRelativePath,
  exportName: Domain.ExportName,
  publicPackages: Schema.Array(Schema.String),
})

/** Controlled SecureStore scenario understood by the trusted runner. */
export const ScenarioId = Schema.Literals(["round-trip", "read-failure", "write-failure"])
/** Controlled SecureStore scenario identity. */
export type ScenarioId = Schema.Schema.Type<typeof ScenarioId>

/** Validates that the SecureStore grader defines each reviewed scenario exactly once. */
export const validateScenarioIds = (ids: ReadonlyArray<ScenarioId>) =>
  Workspace.validateScenarioIds(ids, ScenarioId.literals, "incomplete-secure-store-scenarios")

const Expected = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  scenarios: Schema.Array(Schema.Struct({ id: ScenarioId })),
})

interface TaskData extends TaskModel.TaskBase<Schema.Schema.Type<typeof TaskDefinition>> {
  readonly taskType: "secure-store"
  readonly scenarios: Schema.Schema.Type<typeof Expected>["scenarios"]
}

/** Loaded public SecureStore temporary-secret task. */
export type Task = TaskData &
  Pick<TaskModel.ReviewedTask<Schema.Schema.Type<typeof TaskDefinition>>, "verify">

/** Per-gate result of verifying SecureStore consumption against controlled native scenarios. */
export interface VerificationResult {
  readonly passed: boolean
  readonly packageBoundaryPassed: boolean
  readonly roundTripPassed: boolean
  readonly cleanupPassed: boolean
  readonly readFailurePassed: boolean
  readonly writeFailurePassed: boolean
  readonly layerProvisioningPassed: boolean
  readonly packageDigest: Domain.Sha256Digest
  readonly observations: ReadonlyArray<unknown>
  readonly isolation: ReadonlyArray<Isolation.IsolationObservation>
  readonly moduleLoadFailed: boolean
}

const Observation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("secure-store-consumer"),
  effectIsValid: Schema.Boolean,
  effectSucceeded: Schema.Boolean,
  value: Schema.optional(Schema.Json),
  failureTag: Schema.optional(Schema.Json),
  failureMethod: Schema.optional(Schema.Json),
  failureKey: Schema.optional(Schema.Json),
  writes: Domain.NonNegativeInteger,
  reads: Domain.NonNegativeInteger,
  deletes: Domain.NonNegativeInteger,
  operations: Schema.Array(Schema.Literals(["write", "read", "delete"])),
  valuePresent: Schema.Boolean,
  optionsMatched: Schema.Boolean,
  failureCategory: Schema.optional(Schema.Literal("module-load")),
})
type Observation = Schema.Schema.Type<typeof Observation>

const decodeObservation = (value: unknown) =>
  Schema.decodeUnknownEffect(Observation)(value).pipe(
    Effect.mapError(
      () => new Verifier.VerificationInvalid({ reason: "invalid-secure-store-observation" }),
    ),
  )

/** Loads and validates the repository-owned SecureStore task bundle. */
export const load = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const path = yield* Path.Path
  const fixturePath = Domain.TaskRelativePath.make("src/ReadTemporarySecret.ts")
  const files = yield* Workspace.readTaskFiles(
    path.join(config.repositoryRoot, "evals", "tasks", "secure-store"),
    fixturePath,
  )
  const definition = yield* Workspace.decodeJson(
    TaskDefinition,
    files.encodedDefinition,
    "invalid-secure-store-task-definition",
  )
  if (
    definition.publicPackages.length !== 1 ||
    definition.publicPackages[0] !== "@better-native/secure-store"
  ) {
    return yield* new Workspace.TaskBundleInvalid({
      reason: "invalid-secure-store-public-package-set",
    })
  }
  const expected = yield* Workspace.decodeJson(
    Expected,
    files.encodedExpected,
    "invalid-secure-store-grader-data",
  )
  yield* validateScenarioIds(expected.scenarios.map((scenario) => scenario.id))
  const task = {
    taskType: "secure-store",
    root: files.root,
    instruction: files.instruction,
    fixtureFiles: [{ path: fixturePath, content: files.fixtureSource }],
    scenarios: expected.scenarios,
    definition,
    publicPackages: definition.publicPackages,
    packedPackage: {
      taskName: "secure-store",
      packageDirectory: "secure-store",
      packageName: "@better-native/secure-store",
      nativeDouble: "expo-secure-store",
    },
    evaluatorBundle: yield* Workspace.readEvaluatorBundle(
      "secure-store",
      "SecureStore.ts",
      "secure-store",
    ),
  } satisfies TaskData
  return {
    ...task,
    verify: (submission: Submission.Submission) => verify(task, submission),
  } satisfies Task
})

/** Verifies resource-safe SecureStore consumption through the packed public package. */
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
              runner: "observe-secure-store.ts",
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
      const byScenario = (id: ScenarioId) => results.find((result) => result.scenario.id === id)
      const roundTrip = byScenario("round-trip")?.observation
      const readFailure = byScenario("read-failure")?.observation
      const writeFailure = byScenario("write-failure")?.observation
      const roundTripPassed =
        roundTrip?.effectIsValid === true &&
        roundTrip.effectSucceeded &&
        roundTrip.value === "controlled-secret" &&
        roundTrip.writes === 1 &&
        roundTrip.reads === 1
      const cleanupPassed =
        roundTrip?.deletes === 1 &&
        !roundTrip.valuePresent &&
        roundTrip.operations.join(",") === "write,read,delete" &&
        readFailure?.deletes === 1 &&
        !readFailure.valuePresent &&
        readFailure.operations.join(",") === "write,read,delete" &&
        writeFailure?.deletes === 0 &&
        !writeFailure.valuePresent &&
        writeFailure.operations.join(",") === "write"
      const readFailurePassed =
        readFailure?.effectIsValid === true &&
        !readFailure.effectSucceeded &&
        readFailure.failureTag === "SecureStoreFailure" &&
        readFailure.failureMethod === "getItemAsync" &&
        readFailure.failureKey === "dx.eval.token" &&
        readFailure.writes === 1 &&
        readFailure.reads === 1
      const writeFailurePassed =
        writeFailure?.effectIsValid === true &&
        !writeFailure.effectSucceeded &&
        writeFailure.failureTag === "SecureStoreFailure" &&
        writeFailure.failureMethod === "setItemAsync" &&
        writeFailure.failureKey === "dx.eval.token" &&
        writeFailure.writes === 1 &&
        writeFailure.reads === 0
      const layerProvisioningPassed =
        results.every(
          ({ observation }) => observation.effectIsValid && observation.optionsMatched,
        ) &&
        roundTrip?.writes === 1 &&
        roundTrip.reads === 1 &&
        readFailure?.writes === 1 &&
        readFailure.reads === 1 &&
        writeFailure?.writes === 1
      const packageBoundaryPassed =
        workspace.packageSource === "packed-public-package" &&
        workspace.packageDigest !== null &&
        SourcePolicy.checkPublicConsumer(candidateSource, "@better-native/secure-store").passed
      const moduleLoadFailed = results.some(
        ({ observation }) => observation.failureCategory === "module-load",
      )
      if (workspace.packageDigest === null) {
        return yield* new Verifier.VerificationInvalid({
          reason: "missing-packed-secure-store-digest",
        })
      }
      return {
        passed:
          packageBoundaryPassed &&
          roundTripPassed &&
          cleanupPassed &&
          readFailurePassed &&
          writeFailurePassed &&
          layerProvisioningPassed,
        packageBoundaryPassed,
        roundTripPassed,
        cleanupPassed,
        readFailurePassed,
        writeFailurePassed,
        layerProvisioningPassed,
        packageDigest: workspace.packageDigest,
        observations: results.map(({ observation }) => observation),
        isolation: results.map(({ isolated }) => isolated),
        moduleLoadFailed,
      } satisfies VerificationResult
    }),
  )

/** Verifies SecureStore and maps its safety dimensions to reporter-facing gates. */
export const verify = (task: TaskData, submission: Submission.Submission) =>
  verifySubmission(task, submission).pipe(
    Effect.map(
      (result) =>
        ({
          observation: { packageDigest: result.packageDigest, scenarios: result.observations },
          toolName: "verify_secure_store_effect",
          gates: [
            {
              id: Domain.GateId.make("secure-store.public-package-boundary"),
              required: true,
              ...TaskModel.gateDecision(
                result.packageBoundaryPassed,
                "The candidate consumed the packed public SecureStore package without internal imports.",
                "The candidate did not stay within the packed public SecureStore package boundary.",
                "source-policy",
              ),
            },
            {
              id: Domain.GateId.make("secure-store.round-trip"),
              required: true,
              ...TaskModel.gateDecision(
                result.roundTripPassed,
                "The Effect stored and returned the controlled secret through SecureStore.",
                "The exported Effect did not complete the controlled SecureStore round trip.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("secure-store.cleanup"),
              required: true,
              ...TaskModel.gateDecision(
                result.cleanupPassed,
                "Cleanup deleted the temporary secret after success and read failure only.",
                "Temporary-secret cleanup did not match the acquire/use/release contract.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("secure-store.read-failure"),
              required: true,
              ...TaskModel.gateDecision(
                result.readFailurePassed,
                "Native read failure retained its SecureStoreFailure method and key.",
                "Native read failure did not preserve the declared SecureStoreFailure metadata.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("secure-store.write-failure"),
              required: true,
              ...TaskModel.gateDecision(
                result.writeFailurePassed,
                "Native write failure retained its SecureStoreFailure method and key.",
                "Native write failure did not preserve the declared SecureStoreFailure metadata.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("secure-store.layer-provisioning"),
              required: true,
              ...TaskModel.gateDecision(
                result.layerProvisioningPassed,
                "The provided SecureStore layer reached the controlled native API with reviewed options.",
                "The Effect did not provision SecureStore.live with the reviewed key and service.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
          ],
        }) satisfies TaskModel.TrialVerification,
    ),
  )
