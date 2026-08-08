import { isDeepStrictEqual } from "node:util"
import * as Effect from "effect/Effect"
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
  schemaVersion: Schema.Literal(2),
  taskType: Schema.Literal("network"),
  id: Domain.TaskId,
  version: Domain.TaskVersion,
  allowedSubmissionPaths: Schema.Array(Domain.TaskRelativePath),
  entrypoint: Domain.TaskRelativePath,
  exportName: Domain.ExportName,
  schemaExportName: Domain.ExportName,
  publicCompileContract: TaskModel.PublicCompileContract,
  publicPackages: Schema.Array(Schema.String),
})

/** Scenario identity supplied only by the trusted Network verifier. */
export const ScenarioId = Schema.Literals(["available", "unavailable", "failure", "malformed"])
/** Controlled native scenario understood by the trusted Network runner. */
export type ScenarioId = Schema.Schema.Type<typeof ScenarioId>

/** Validates that the Network grader defines each reviewed scenario exactly once. */
export const validateScenarioIds = (ids: ReadonlyArray<ScenarioId>) =>
  Workspace.validateScenarioIds(ids, ScenarioId.literals, "incomplete-network-scenarios")

const Expected = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  scenarios: Schema.Array(
    Schema.Struct({
      id: ScenarioId,
      expected: Schema.Json,
    }),
  ),
})

/** Loaded public Network consumer task. */
interface TaskData extends TaskModel.TaskBase<Schema.Schema.Type<typeof TaskDefinition>> {
  readonly taskType: "network"
  readonly scenarios: Schema.Schema.Type<typeof Expected>["scenarios"]
}

/** Loaded public Network consumer task. */
export type Task = TaskData &
  Pick<TaskModel.ReviewedTask<Schema.Schema.Type<typeof TaskDefinition>>, "verify">

/** Per-gate result of verifying Network consumption against controlled native scenarios. */
export interface VerificationResult {
  readonly passed: boolean
  readonly packageBoundaryPassed: boolean
  readonly schemaPassed: boolean
  readonly availablePassed: boolean
  readonly unavailablePassed: boolean
  readonly failurePassed: boolean
  readonly packageDigest: Domain.Sha256Digest
  readonly observations: ReadonlyArray<unknown>
  readonly isolation: ReadonlyArray<Isolation.IsolationObservation>
  readonly moduleLoadFailed: boolean
}

const Observation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("network-consumer"),
  effectIsValid: Schema.Boolean,
  effectSucceeded: Schema.Boolean,
  schemaIsValid: Schema.Boolean,
  schemaAcceptsOutput: Schema.Boolean,
  schemaRejectsInvalid: Schema.Boolean,
  nativeCalls: Domain.NonNegativeInteger,
  value: Schema.optional(Schema.Json),
  failureCategory: Schema.optional(Schema.Literal("module-load")),
})
type Observation = Schema.Schema.Type<typeof Observation>

const decodeObservation = (
  value: unknown,
): Effect.Effect<Observation, Verifier.VerificationInvalid> =>
  Schema.decodeUnknownEffect(Observation)(value).pipe(
    Effect.mapError(
      () =>
        new Verifier.VerificationInvalid({
          reason: "invalid-network-observation",
        }),
    ),
  )

/** Loads and validates the repository-owned Network consumer task bundle. */
export const load = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const path = yield* Path.Path
  const fixturePath = Domain.TaskRelativePath.make("src/ReadNetwork.ts")
  const files = yield* Workspace.readTaskFiles(
    path.join(config.repositoryRoot, "evals", "tasks", "network"),
    fixturePath,
  )
  const definition = yield* Workspace.decodeJson(
    TaskDefinition,
    files.encodedDefinition,
    "invalid-network-task-definition",
  )
  if (
    definition.publicPackages.length !== 1 ||
    definition.publicPackages[0] !== "@better-native/network"
  ) {
    return yield* new Workspace.TaskBundleInvalid({
      reason: "invalid-network-public-package-set",
    })
  }
  if (definition.publicCompileContract.exportName !== definition.exportName) {
    return yield* new Workspace.TaskBundleInvalid({
      reason: "invalid-network-public-compile-contract",
    })
  }
  const expected = yield* Workspace.decodeJson(
    Expected,
    files.encodedExpected,
    "invalid-network-grader-data",
  )
  const evaluatorBundle = yield* Workspace.readEvaluatorBundle("network", "Network.ts", "network")
  yield* validateScenarioIds(expected.scenarios.map((scenario) => scenario.id))
  const task = {
    taskType: "network",
    root: files.root,
    instruction: files.instruction,
    fixtureFiles: [{ path: fixturePath, content: files.fixtureSource }],
    scenarios: expected.scenarios,
    definition,
    publicPackages: definition.publicPackages,
    packedPackage: {
      taskName: "network",
      packageDirectory: "network",
      packageName: "@better-native/network",
      nativeDouble: "expo-network",
    },
    evaluatorBundle,
  } satisfies TaskData
  return {
    ...task,
    verify: (submission: Submission.Submission) => verify(task, submission),
  } satisfies Task
})

/** Verifies public Network consumption without exposing implementation or grader internals. */
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
              runner: "observe-network.ts",
              runnerArguments: [task.definition.schemaExportName, scenario.id],
            })
            const parsed = yield* Verifier.parseObservation(isolated)
            const observation = yield* decodeObservation(parsed)
            const passed =
              observation.effectIsValid &&
              observation.effectSucceeded &&
              observation.schemaIsValid &&
              observation.schemaAcceptsOutput &&
              observation.nativeCalls === 1 &&
              isDeepStrictEqual(observation.value, scenario.expected)
            return { scenario, observation, isolated, passed }
          }),
        { concurrency: 1 },
      )
      const byScenario = (id: ScenarioId) => results.find((result) => result.scenario.id === id)
      const availablePassed = byScenario("available")?.passed === true
      const unavailablePassed = byScenario("unavailable")?.passed === true
      const failurePassed =
        byScenario("failure")?.passed === true && byScenario("malformed")?.passed === true
      const schemaPassed = results.every(
        (result) => result.observation.schemaIsValid && result.observation.schemaRejectsInvalid,
      )
      const moduleLoadFailed = results.some(
        (result) => result.observation.failureCategory === "module-load",
      )
      const packageBoundaryPassed =
        workspace.packageSource === "packed-public-package" &&
        workspace.packageDigest !== null &&
        SourcePolicy.checkPublicConsumer(candidateSource, "@better-native/network").passed
      if (workspace.packageDigest === null) {
        return yield* new Verifier.VerificationInvalid({
          reason: "missing-packed-network-digest",
        })
      }
      return {
        passed:
          availablePassed &&
          unavailablePassed &&
          failurePassed &&
          schemaPassed &&
          packageBoundaryPassed,
        packageBoundaryPassed,
        schemaPassed,
        availablePassed,
        unavailablePassed,
        failurePassed,
        packageDigest: workspace.packageDigest,
        observations: results.map((result) => result.observation),
        isolation: results.map((result) => result.isolated),
        moduleLoadFailed,
      } satisfies VerificationResult
    }),
  )

/** Verifies Network and maps its dimensions to reporter-facing gates. */
export const verify = (task: TaskData, submission: Submission.Submission) =>
  verifySubmission(task, submission).pipe(
    Effect.map(
      (result) =>
        ({
          observation: {
            packageDigest: result.packageDigest,
            scenarios: result.observations,
          },
          toolName: "verify_network_consumer",
          gates: [
            {
              id: Domain.GateId.make("network.public-package-boundary"),
              required: true,
              ...TaskModel.gateDecision(
                result.packageBoundaryPassed,
                "The candidate consumed the packed public Network package without internal imports.",
                "The candidate did not stay within the packed public Network package boundary.",
                "source-policy",
              ),
            },
            {
              id: Domain.GateId.make("network.available-state"),
              required: true,
              ...TaskModel.gateDecision(
                result.availablePassed,
                "The one-shot Effect produced the schema-valid available state with one native read.",
                "The available-state scenario did not produce the required one-shot observation.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("network.unavailable-error"),
              required: true,
              ...TaskModel.gateDecision(
                result.unavailablePassed,
                "NetworkUnavailable remained distinct and mapped to the declared output.",
                "NetworkUnavailable was not handled as the declared distinct outcome.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("network.failure-error"),
              required: true,
              ...TaskModel.gateDecision(
                result.failurePassed,
                "Native rejection and malformed native state both remained NetworkFailure outcomes.",
                "NetworkFailure handling did not cover native rejection and malformed state.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
            {
              id: Domain.GateId.make("network.output-schema"),
              required: true,
              ...TaskModel.gateDecision(
                result.schemaPassed,
                "The exported Schema accepted declared outputs and rejected invalid shapes.",
                "The exported Schema did not enforce the declared output contract.",
                result.moduleLoadFailed ? "module-load" : "scenario",
              ),
            },
          ],
        }) satisfies TaskModel.TrialVerification,
    ),
  )
