import { isDeepStrictEqual } from "node:util"
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
import * as SourcePolicy from "./SourcePolicy.ts"
import * as Workspace from "./Workspace.ts"

const TaskDefinition = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  taskType: Schema.Literal("battery"),
  id: Domain.TaskId,
  version: Domain.TaskVersion,
  allowedSubmissionPaths: Schema.Array(Domain.TaskRelativePath),
  entrypoint: Domain.TaskRelativePath,
  exportName: Domain.ExportName,
  publicPackages: Schema.Array(Schema.String),
})

/** Controlled Battery scenario understood by the trusted reactive runner. */
export const ScenarioId = Schema.Literals(["two-events", "early-stop", "listener-failure"])
/** Controlled Battery scenario identity. */
export type ScenarioId = Schema.Schema.Type<typeof ScenarioId>

/** Validates that the Battery grader defines each reviewed scenario exactly once. */
export const validateScenarioIds = (ids: ReadonlyArray<ScenarioId>) =>
  Workspace.validateScenarioIds(ids, ScenarioId.literals, "incomplete-battery-scenarios")

const Expected = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  scenarios: Schema.Array(
    Schema.Struct({
      id: ScenarioId,
      take: Domain.PositiveInteger,
      expectedValues: Schema.Array(Schema.Number),
      expectedFailureMethod: Schema.NullOr(Schema.String),
    }),
  ),
})

/** Loaded public Battery reactive-consumer task. */
type TaskData = TaskModel.TaskBase<Schema.Schema.Type<typeof TaskDefinition>> & {
  readonly taskType: "battery"
  readonly scenarios: Schema.Schema.Type<typeof Expected>["scenarios"]
}

/** Loaded public Battery reactive-consumer task. */
export type Task = TaskModel.ReviewedTask<TaskData>

/** Per-gate result of verifying Battery streams against controlled native events. */
export interface VerificationResult {
  readonly passed: boolean
  readonly packageBoundaryPassed: boolean
  readonly streamEventsPassed: boolean
  readonly scopedLifecyclePassed: boolean
  readonly listenerCleanupPassed: boolean
  readonly failurePreservationPassed: boolean
  readonly layerProvisioningPassed: boolean
  readonly packageDigest: Domain.Sha256Digest
  readonly observations: ReadonlyArray<unknown>
  readonly isolation: ReadonlyArray<Isolation.IsolationObservation>
  readonly moduleLoadFailed: boolean
}

const Observation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("battery-consumer"),
  streamIsValid: Schema.Boolean,
  streamSucceeded: Schema.Boolean,
  values: Schema.Array(Schema.Json),
  failureTag: Schema.optional(Schema.Json),
  failureMethod: Schema.optional(Schema.Json),
  registrations: Domain.NonNegativeInteger,
  removals: Domain.NonNegativeInteger,
  emitted: Domain.NonNegativeInteger,
  failureCategory: Schema.optional(Schema.Literal("module-load")),
})
type Observation = Schema.Schema.Type<typeof Observation>

const decodeObservation = (
  value: unknown,
): Effect.Effect<Observation, Verifier.VerificationInvalid> =>
  Schema.decodeUnknownEffect(Observation)(value).pipe(
    Effect.mapError(
      () => new Verifier.VerificationInvalid({ reason: "invalid-battery-observation" }),
    ),
  )

/** Loads and validates the repository-owned Battery reactive-consumer task bundle. */
export const load = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const path = yield* Path.Path
  const fixturePath = Domain.TaskRelativePath.make("src/ObserveBattery.ts")
  const files = yield* Workspace.readTaskFiles(
    path.join(config.repositoryRoot, "evals", "tasks", "battery"),
    fixturePath,
  )
  const definition = yield* Workspace.decodeJson(
    TaskDefinition,
    files.encodedDefinition,
    "invalid-battery-task-definition",
  )
  if (
    definition.publicPackages.length !== 1 ||
    definition.publicPackages[0] !== "@better-native/battery"
  ) {
    return yield* new Workspace.TaskBundleInvalid({
      reason: "invalid-battery-public-package-set",
    })
  }
  const expected = yield* Workspace.decodeJson(
    Expected,
    files.encodedExpected,
    "invalid-battery-grader-data",
  )
  const evaluatorBundle = yield* Workspace.readEvaluatorBundle("battery", "Battery.ts", "battery")
  yield* validateScenarioIds(expected.scenarios.map((scenario) => scenario.id))
  const task = {
    taskType: "battery",
    root: files.root,
    instruction: files.instruction,
    fixtureFiles: [{ path: fixturePath, content: files.fixtureSource }],
    scenarios: expected.scenarios,
    definition,
    publicPackages: definition.publicPackages,
    packedPackage: {
      taskName: "battery",
      packageDirectory: "battery",
      packageName: "@better-native/battery",
      nativeDouble: "expo-battery",
    },
    evaluatorBundle,
  } satisfies TaskData
  return {
    ...task,
    verify: (submission: Submission.Submission) => verify(task, submission),
  } satisfies Task
})

/** Verifies resource-safe Battery stream consumption through the packed public package. */
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
              runner: "observe-battery.ts",
              runnerArguments: [scenario.id, String(scenario.take)],
            })
            const parsed = yield* Verifier.parseObservation(isolated)
            const observation = yield* decodeObservation(parsed)
            const outcomePassed = Match.value(scenario.expectedFailureMethod).pipe(
              Match.when(
                null,
                () =>
                  observation.streamSucceeded &&
                  isDeepStrictEqual(observation.values, scenario.expectedValues),
              ),
              Match.when(
                Match.string,
                (expectedFailureMethod) =>
                  !observation.streamSucceeded &&
                  observation.failureTag === "BatteryFailure" &&
                  observation.failureMethod === expectedFailureMethod,
              ),
              Match.exhaustive,
            )
            return {
              scenario,
              observation,
              isolated,
              passed: observation.streamIsValid && outcomePassed,
            }
          }),
        { concurrency: 1 },
      )
      const byScenario = (id: ScenarioId) => results.find((result) => result.scenario.id === id)
      const twoEvents = byScenario("two-events")
      const earlyStop = byScenario("early-stop")
      const listenerFailure = byScenario("listener-failure")
      const streamEventsPassed = twoEvents?.passed === true && earlyStop?.passed === true
      const scopedLifecyclePassed =
        earlyStop?.observation.registrations === 1 && earlyStop.observation.removals === 1
      const listenerCleanupPassed =
        twoEvents?.observation.registrations === 1 &&
        twoEvents.observation.removals === 1 &&
        listenerFailure?.observation.registrations === 1 &&
        listenerFailure.observation.removals === 0
      const failurePreservationPassed = listenerFailure?.passed === true
      const layerProvisioningPassed =
        twoEvents?.observation.registrations === 1 &&
        twoEvents.observation.emitted >= 2 &&
        earlyStop?.observation.registrations === 1 &&
        earlyStop.observation.emitted >= 1
      const packageBoundaryPassed =
        workspace.packageSource === "packed-public-package" &&
        workspace.packageDigest !== null &&
        SourcePolicy.checkPublicConsumer(candidateSource, "@better-native/battery").passed
      const moduleLoadFailed = results.some(
        (result) => result.observation.failureCategory === "module-load",
      )
      if (workspace.packageDigest === null) {
        return yield* new Verifier.VerificationInvalid({
          reason: "missing-packed-battery-digest",
        })
      }
      return {
        passed:
          packageBoundaryPassed &&
          streamEventsPassed &&
          scopedLifecyclePassed &&
          listenerCleanupPassed &&
          failurePreservationPassed &&
          layerProvisioningPassed,
        packageBoundaryPassed,
        streamEventsPassed,
        scopedLifecyclePassed,
        listenerCleanupPassed,
        failurePreservationPassed,
        layerProvisioningPassed,
        packageDigest: workspace.packageDigest,
        observations: results.map((result) => result.observation),
        isolation: results.map((result) => result.isolated),
        moduleLoadFailed,
      } satisfies VerificationResult
    }),
  )

/** Verifies Battery and maps its lifecycle dimensions to reporter-facing gates. */
export const verify = (task: TaskData, submission: Submission.Submission) =>
  verifySubmission(task, submission).pipe(
    Effect.map(
      (result) =>
        ({
          observation: { packageDigest: result.packageDigest, scenarios: result.observations },
          toolName: "verify_battery_stream",
          gates: [
            {
              id: Domain.GateId.make("battery.public-package-boundary"),
              required: true,
              ...TaskModel.gateDecision(
                result.packageBoundaryPassed,
                "The candidate consumed the packed public Battery package without internal imports.",
                "The candidate did not stay within the packed public Battery package boundary.",
                "source-policy",
              ),
            },
            {
              id: Domain.GateId.make("battery.stream-events"),
              required: true,
              ...TaskModel.gateDecision(
                result.streamEventsPassed,
                "The Effect Stream emitted the controlled battery levels in order.",
                "The exported stream did not emit the controlled battery levels.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("battery.scoped-subscription-lifecycle"),
              required: true,
              ...TaskModel.gateDecision(
                result.scopedLifecyclePassed,
                "Early downstream termination finalized the scoped native subscription.",
                "Early downstream termination did not finalize exactly one native subscription.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("battery.listener-cleanup"),
              required: true,
              ...TaskModel.gateDecision(
                result.listenerCleanupPassed,
                "Listener cleanup ran exactly once after normal completion and avoided a phantom cleanup after failed registration.",
                "Listener cleanup did not match the normal-completion and failed-registration contracts.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("battery.failure-preservation"),
              required: true,
              ...TaskModel.gateDecision(
                result.failurePreservationPassed,
                "Native listener registration failure remained a BatteryFailure with its method preserved.",
                "Native listener registration failure was not preserved as the declared BatteryFailure.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("battery.layer-provisioning"),
              required: true,
              ...TaskModel.gateDecision(
                result.layerProvisioningPassed,
                "The provided Battery layer activated the controlled native listener for each stream run.",
                "The stream did not provision and activate the public Battery layer.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
          ],
        }) satisfies TaskModel.TrialVerification,
    ),
  )
