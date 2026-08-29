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
  taskType: Schema.Literal("clipboard"),
  id: Domain.TaskId,
  version: Domain.TaskVersion,
  allowedSubmissionPaths: Schema.Array(Domain.TaskRelativePath),
  entrypoint: Domain.TaskRelativePath,
  exportName: Domain.ExportName,
  publicPackages: Schema.Array(Schema.String),
})

/** Controlled Clipboard scenario understood by the trusted reactive runner. */
export const ScenarioId = Schema.Literals(["two-events", "early-stop", "listener-failure"])
/** Controlled Clipboard scenario identity. */
export type ScenarioId = Schema.Schema.Type<typeof ScenarioId>

/** Validates that the Clipboard grader defines each reviewed scenario exactly once. */
export const validateScenarioIds = (ids: ReadonlyArray<ScenarioId>) =>
  Workspace.validateScenarioIds(ids, ScenarioId.literals, "incomplete-clipboard-scenarios")

const Expected = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  scenarios: Schema.Array(
    Schema.Struct({
      id: ScenarioId,
      take: Domain.PositiveInteger,
      expectedValues: Schema.Array(Schema.Array(Schema.String)),
      expectedFailureMethod: Schema.NullOr(Schema.String),
    }),
  ),
})

/** Loaded public Clipboard reactive-consumer task. */
type TaskData = TaskModel.TaskBase<Schema.Schema.Type<typeof TaskDefinition>> & {
  readonly taskType: "clipboard"
  readonly scenarios: Schema.Schema.Type<typeof Expected>["scenarios"]
}

/** Loaded public Clipboard reactive-consumer task. */
export type Task = TaskModel.ReviewedTask<TaskData>

/** Per-gate result of verifying Clipboard streams against controlled native events. */
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
  kind: Schema.Literal("clipboard-consumer"),
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
      () => new Verifier.VerificationInvalid({ reason: "invalid-clipboard-observation" }),
    ),
  )

/** Loads and validates the repository-owned Clipboard reactive-consumer task bundle. */
export const load = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const path = yield* Path.Path
  const fixturePath = Domain.TaskRelativePath.make("src/ObserveClipboard.ts")
  const files = yield* Workspace.readTaskFiles(
    path.join(config.repositoryRoot, "evals", "tasks", "clipboard"),
    fixturePath,
  )
  const definition = yield* Workspace.decodeJson(
    TaskDefinition,
    files.encodedDefinition,
    "invalid-clipboard-task-definition",
  )
  if (
    definition.publicPackages.length !== 1 ||
    definition.publicPackages[0] !== "@better-native/clipboard"
  ) {
    return yield* new Workspace.TaskBundleInvalid({
      reason: "invalid-clipboard-public-package-set",
    })
  }
  const expected = yield* Workspace.decodeJson(
    Expected,
    files.encodedExpected,
    "invalid-clipboard-grader-data",
  )
  const evaluatorBundle = yield* Workspace.readEvaluatorBundle(
    "clipboard",
    "Clipboard.ts",
    "clipboard",
  )
  yield* validateScenarioIds(expected.scenarios.map((scenario) => scenario.id))
  const task = {
    taskType: "clipboard",
    root: files.root,
    instruction: files.instruction,
    fixtureFiles: [{ path: fixturePath, content: files.fixtureSource }],
    scenarios: expected.scenarios,
    definition,
    publicPackages: definition.publicPackages,
    packedPackage: {
      taskName: "clipboard",
      packageDirectory: "clipboard",
      packageName: "@better-native/clipboard",
      nativeDouble: "expo-clipboard",
    },
    evaluatorBundle,
  } satisfies TaskData
  return {
    ...task,
    verify: (submission: Submission.Submission) => verify(task, submission),
  } satisfies Task
})

/** Verifies resource-safe Clipboard stream consumption through the packed public package. */
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
              runner: "observe-clipboard.ts",
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
                  observation.failureTag === "ClipboardFailure" &&
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
        SourcePolicy.checkPublicConsumer(candidateSource, "@better-native/clipboard").passed
      const moduleLoadFailed = results.some(
        (result) => result.observation.failureCategory === "module-load",
      )
      if (workspace.packageDigest === null) {
        return yield* new Verifier.VerificationInvalid({
          reason: "missing-packed-clipboard-digest",
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

/** Verifies Clipboard and maps its lifecycle dimensions to reporter-facing gates. */
export const verify = (task: TaskData, submission: Submission.Submission) =>
  verifySubmission(task, submission).pipe(
    Effect.map(
      (result) =>
        ({
          observation: { packageDigest: result.packageDigest, scenarios: result.observations },
          toolName: "verify_clipboard_stream",
          gates: [
            {
              id: Domain.GateId.make("clipboard.public-package-boundary"),
              required: true,
              ...TaskModel.gateDecision(
                result.packageBoundaryPassed,
                "The candidate consumed the packed public Clipboard package without internal imports.",
                "The candidate did not stay within the packed public Clipboard package boundary.",
                "source-policy",
              ),
            },
            {
              id: Domain.GateId.make("clipboard.stream-events"),
              required: true,
              ...TaskModel.gateDecision(
                result.streamEventsPassed,
                "The Effect Stream emitted the controlled clipboard content types in order.",
                "The exported stream did not emit the controlled clipboard content types.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("clipboard.scoped-subscription-lifecycle"),
              required: true,
              ...TaskModel.gateDecision(
                result.scopedLifecyclePassed,
                "Early downstream termination finalized the scoped native subscription.",
                "Early downstream termination did not finalize exactly one native subscription.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("clipboard.listener-cleanup"),
              required: true,
              ...TaskModel.gateDecision(
                result.listenerCleanupPassed,
                "Listener cleanup ran exactly once after normal completion and avoided a phantom cleanup after failed registration.",
                "Listener cleanup did not match the normal-completion and failed-registration contracts.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("clipboard.failure-preservation"),
              required: true,
              ...TaskModel.gateDecision(
                result.failurePreservationPassed,
                "Native listener registration failure remained a ClipboardFailure with its method preserved.",
                "Native listener registration failure was not preserved as the declared ClipboardFailure.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("clipboard.layer-provisioning"),
              required: true,
              ...TaskModel.gateDecision(
                result.layerProvisioningPassed,
                "The provided Clipboard layer activated the controlled native listener for each stream run.",
                "The stream did not provision and activate the public Clipboard layer.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
          ],
        }) satisfies TaskModel.TrialVerification,
    ),
  )
