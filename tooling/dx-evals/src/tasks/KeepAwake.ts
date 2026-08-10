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
  schemaVersion: Schema.Literal(2),
  taskType: Schema.Literal("keep-awake"),
  id: Domain.TaskId,
  version: Domain.TaskVersion,
  allowedSubmissionPaths: Schema.Array(Domain.TaskRelativePath),
  entrypoint: Domain.TaskRelativePath,
  exportName: Domain.ExportName,
  publicCompileContract: TaskModel.PublicCompileContract,
  publicPackages: Schema.Array(Schema.String),
})

/** Scenario identity supplied only by the trusted Keep Awake verifier. */
export const ScenarioId = Schema.Literals([
  "active-until-interrupt",
  "unavailable",
  "activation-failure",
])
/** Controlled native scenario understood by the trusted Keep Awake runner. */
export type ScenarioId = Schema.Schema.Type<typeof ScenarioId>

/** Validates that the Keep Awake grader defines each reviewed scenario exactly once. */
export const validateScenarioIds = (ids: ReadonlyArray<ScenarioId>) =>
  Workspace.validateScenarioIds(ids, ScenarioId.literals, "incomplete-keep-awake-scenarios")

const Expected = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  scenarios: Schema.Array(Schema.Struct({ id: ScenarioId })),
})

type TaskData = TaskModel.TaskBase<Schema.Schema.Type<typeof TaskDefinition>> & {
  readonly taskType: "keep-awake"
  readonly scenarios: Schema.Schema.Type<typeof Expected>["scenarios"]
}

/** Loaded public Keep Awake scoped-resource task. */
export type Task = TaskModel.ReviewedTask<TaskData>

/** Per-gate result of verifying a Keep Awake lease against controlled native scenarios. */
export interface VerificationResult {
  readonly passed: boolean
  readonly packageBoundaryPassed: boolean
  readonly activeLeasePassed: boolean
  readonly scopedCleanupPassed: boolean
  readonly unavailablePassed: boolean
  readonly activationFailurePassed: boolean
  readonly layerProvisioningPassed: boolean
  readonly packageDigest: Domain.Sha256Digest
  readonly observations: ReadonlyArray<unknown>
  readonly isolation: ReadonlyArray<Isolation.IsolationObservation>
  readonly moduleLoadFailed: boolean
}

const Observation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("keep-awake-consumer"),
  effectIsValid: Schema.Boolean,
  effectSucceeded: Schema.Boolean,
  activeBeforeInterrupt: Schema.Boolean,
  failureTag: Schema.optional(Schema.Json),
  failureMethod: Schema.optional(Schema.Json),
  availabilityChecks: Domain.NonNegativeInteger,
  activations: Domain.NonNegativeInteger,
  deactivations: Domain.NonNegativeInteger,
  activatedTags: Schema.Array(Schema.String),
  deactivatedTags: Schema.Array(Schema.String),
  failureCategory: Schema.optional(Schema.Literal("module-load")),
})
type Observation = Schema.Schema.Type<typeof Observation>

const decodeObservation = (value: unknown) =>
  Schema.decodeUnknownEffect(Observation)(value).pipe(
    Effect.mapError(
      () =>
        new Verifier.VerificationInvalid({
          reason: "invalid-keep-awake-observation",
        }),
    ),
  )

/** Loads and validates the repository-owned Keep Awake task bundle. */
export const load = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const path = yield* Path.Path
  const fixturePath = Domain.TaskRelativePath.make("src/HoldScreenAwake.ts")
  const files = yield* Workspace.readTaskFiles(
    path.join(config.repositoryRoot, "evals", "tasks", "keep-awake"),
    fixturePath,
  )
  const definition = yield* Workspace.decodeJson(
    TaskDefinition,
    files.encodedDefinition,
    "invalid-keep-awake-task-definition",
  )
  if (
    definition.publicPackages.length !== 1 ||
    definition.publicPackages[0] !== "@better-native/keep-awake"
  ) {
    return yield* new Workspace.TaskBundleInvalid({
      reason: "invalid-keep-awake-public-package-set",
    })
  }
  if (definition.publicCompileContract.exportName !== definition.exportName) {
    return yield* new Workspace.TaskBundleInvalid({
      reason: "invalid-keep-awake-public-compile-contract",
    })
  }
  const expected = yield* Workspace.decodeJson(
    Expected,
    files.encodedExpected,
    "invalid-keep-awake-grader-data",
  )
  yield* validateScenarioIds(expected.scenarios.map((scenario) => scenario.id))
  const task = {
    taskType: "keep-awake",
    root: files.root,
    instruction: files.instruction,
    fixtureFiles: [{ path: fixturePath, content: files.fixtureSource }],
    scenarios: expected.scenarios,
    definition,
    publicPackages: definition.publicPackages,
    packedPackage: {
      taskName: "keep-awake",
      packageDirectory: "keep-awake",
      packageName: "@better-native/keep-awake",
      nativeDouble: "expo-keep-awake",
    },
    evaluatorBundle: yield* Workspace.readEvaluatorBundle(
      "keep-awake",
      "KeepAwake.ts",
      "keep-awake",
    ),
  } satisfies TaskData
  return {
    ...task,
    verify: (submission: Submission.Submission) => verify(task, submission),
  } satisfies Task
})

/** Verifies scoped Keep Awake consumption through the packed public package. */
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
              runner: "observe-keep-awake.ts",
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
      const active = byScenario("active-until-interrupt")?.observation
      const unavailable = byScenario("unavailable")?.observation
      const activationFailure = byScenario("activation-failure")?.observation
      const activeLeasePassed =
        active?.effectIsValid === true &&
        active.activeBeforeInterrupt &&
        active.activations === 1 &&
        active.activatedTags[0] === "dx-eval"
      const scopedCleanupPassed =
        active?.deactivations === 1 && active.deactivatedTags[0] === "dx-eval"
      const unavailablePassed =
        unavailable?.effectIsValid === true &&
        !unavailable.effectSucceeded &&
        unavailable.failureTag === "KeepAwakeUnavailable" &&
        unavailable.failureMethod === "activateKeepAwakeAsync" &&
        unavailable.activations === 0 &&
        unavailable.deactivations === 0
      const activationFailurePassed =
        activationFailure?.effectIsValid === true &&
        !activationFailure.effectSucceeded &&
        activationFailure.failureTag === "KeepAwakeFailure" &&
        activationFailure.failureMethod === "activateKeepAwakeAsync" &&
        activationFailure.activations === 1 &&
        activationFailure.deactivations === 0
      const layerProvisioningPassed = results.every(
        ({ observation }) => observation.effectIsValid && observation.availabilityChecks === 1,
      )
      const packageBoundaryPassed =
        workspace.packageSource === "packed-public-package" &&
        workspace.packageDigest !== null &&
        SourcePolicy.checkPublicConsumer(candidateSource, "@better-native/keep-awake").passed
      const moduleLoadFailed = results.some(
        ({ observation }) => observation.failureCategory === "module-load",
      )
      if (workspace.packageDigest === null) {
        return yield* new Verifier.VerificationInvalid({
          reason: "missing-packed-keep-awake-digest",
        })
      }
      return {
        passed:
          packageBoundaryPassed &&
          activeLeasePassed &&
          scopedCleanupPassed &&
          unavailablePassed &&
          activationFailurePassed &&
          layerProvisioningPassed,
        packageBoundaryPassed,
        activeLeasePassed,
        scopedCleanupPassed,
        unavailablePassed,
        activationFailurePassed,
        layerProvisioningPassed,
        packageDigest: workspace.packageDigest,
        observations: results.map(({ observation }) => observation),
        isolation: results.map(({ isolated }) => isolated),
        moduleLoadFailed,
      } satisfies VerificationResult
    }),
  )

/** Verifies Keep Awake and maps its resource-safety dimensions to reporter-facing gates. */
export const verify = (task: TaskData, submission: Submission.Submission) =>
  verifySubmission(task, submission).pipe(
    Effect.map(
      (result) =>
        ({
          observation: {
            packageDigest: result.packageDigest,
            scenarios: result.observations,
          },
          toolName: "verify_keep_awake_lease",
          gates: [
            {
              id: Domain.GateId.make("keep-awake.public-package-boundary"),
              required: true,
              ...TaskModel.gateDecision(
                result.packageBoundaryPassed,
                "The candidate consumed the packed public Keep Awake package without internal imports.",
                "The candidate did not stay within the packed public Keep Awake package boundary.",
                "source-policy",
              ),
            },
            {
              id: Domain.GateId.make("keep-awake.active-lease"),
              required: true,
              ...TaskModel.gateDecision(
                result.activeLeasePassed,
                "The dx-eval lease remained active while the exported Effect was running.",
                "The exported Effect did not hold the dx-eval lease until interruption.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("keep-awake.scoped-cleanup"),
              required: true,
              ...TaskModel.gateDecision(
                result.scopedCleanupPassed,
                "Interruption deactivated the dx-eval lease exactly once.",
                "Interruption did not deactivate the dx-eval lease exactly once.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("keep-awake.unavailable-error"),
              required: true,
              ...TaskModel.gateDecision(
                result.unavailablePassed,
                "Unavailable support remained a typed KeepAwakeUnavailable failure.",
                "Unavailable support was not preserved as KeepAwakeUnavailable.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("keep-awake.activation-failure"),
              required: true,
              ...TaskModel.gateDecision(
                result.activationFailurePassed,
                "Native activation failure remained a typed KeepAwakeFailure.",
                "Native activation failure was not preserved as KeepAwakeFailure.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("keep-awake.layer-provisioning"),
              required: true,
              ...TaskModel.gateDecision(
                result.layerProvisioningPassed,
                "The provided Keep Awake layer reached the controlled native API in every scenario.",
                "The exported Effect did not provide and use the public Keep Awake layer.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
          ],
        }) satisfies TaskModel.TrialVerification,
    ),
  )
