import type * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import type * as Domain from "../Domain.ts"
import type * as Submission from "../security/Submission.ts"

/** Agent-visible type contract enforced by the public isolated compiler. */
export const PublicCompileContract = Schema.Struct({
  kind: Schema.Literal("effect-no-requirements"),
  exportName: Schema.String.check(Schema.isPattern(/^[A-Za-z_$][A-Za-z0-9_$]*$/)),
})
export type PublicCompileContract = Schema.Schema.Type<typeof PublicCompileContract>

/** Exhaustive reporter-facing result derived from one reviewed boolean gate. */
export const gateResult = (passed: boolean): Domain.GateResult["result"] =>
  Match.value(passed).pipe(
    Match.when(true, () => "pass" as const),
    Match.when(false, () => "fail" as const),
    Match.exhaustive,
  )

/** Exhaustive reporter-facing decision derived from one reviewed boolean gate. */
export const gateDecision = (
  passed: boolean,
  passedRationale: string,
  failedRationale: string,
  failureCategory: Domain.FailureCategory = "scenario",
): Pick<Domain.GateResult, "result" | "rationale" | "failureCategory"> =>
  Match.value(passed).pipe(
    Match.when(true, () => ({
      result: "pass" as const,
      rationale: passedRationale,
    })),
    Match.when(false, () => ({
      result: "fail" as const,
      rationale: failedRationale,
      failureCategory,
    })),
    Match.exhaustive,
  )

/** Common definition fields required by every reviewed task. */
export interface TaskDefinition {
  readonly id: Domain.TaskId
  readonly version: Domain.TaskVersion
  readonly allowedSubmissionPaths: ReadonlyArray<Domain.TaskRelativePath>
  readonly entrypoint: Domain.TaskRelativePath
  readonly exportName: Domain.ExportName
  readonly publicCompileContract?: PublicCompileContract
}

/** One task-owned fixture file. */
export interface FixtureFile {
  readonly path: Domain.TaskRelativePath
  readonly content: string
}

/** Public package and native double installed into a clean-room candidate workspace. */
export interface PackedPackageSpec {
  readonly taskName: string
  readonly packageDirectory: string
  readonly packageName: string
  readonly nativeDouble: string
}

/** Shared task data consumed by task-independent workspace machinery. */
export interface TaskBase<D extends TaskDefinition = TaskDefinition> {
  readonly taskType: string
  readonly root: string
  readonly instruction: string
  readonly fixtureFiles: ReadonlyArray<FixtureFile>
  readonly definition: D
  readonly publicPackages: ReadonlyArray<string>
  readonly packedPackage: PackedPackageSpec | null
  /** Private grader/controller inputs hashed into evidence but never exported to the agent. */
  readonly evaluatorBundle: ReadonlyArray<FixtureFile>
}

/** File-level task export visible to an untrusted adapter. */
export interface TaskExport {
  readonly files: ReadonlyArray<FixtureFile>
  readonly publicPackages: ReadonlyArray<string>
}

/** Agent-visible starting files, including only public package declarations. */
export interface AgentWorkspaceSeed {
  readonly files: ReadonlyArray<FixtureFile>
  readonly editablePaths: ReadonlySet<Domain.TaskRelativePath>
  readonly packageDigests: ReadonlyMap<string, Domain.Sha256Digest>
}

/** Clean-room workspace reconstructed from trusted inputs and one validated submission. */
export interface CandidateWorkspace {
  readonly root: string
  readonly packageSource: "none" | "packed-public-package"
  readonly packageDigest: Domain.Sha256Digest | null
}

/** Task-owned verification output consumed by the generic trial runner. */
export interface TrialVerification {
  readonly observation: unknown
  readonly toolName: string
  readonly gates: ReadonlyArray<Domain.GateResult>
}

/** Shared host services available to task-owned verification programs. */
export type TaskRequirements =
  | import("../Config.ts").DxEvalConfig
  | import("effect/FileSystem").FileSystem
  | import("effect/Crypto").Crypto
  | import("effect/Path").Path
  | import("effect/unstable/process/ChildProcessSpawner").ChildProcessSpawner
  | import("../security/Isolation.ts").Isolation
  | import("./PackageArtifact.ts").PackageArtifacts

/** Expected failures surfaced by task-owned clean-room verification. */
export type TaskVerificationError =
  | import("../evidence/ArtifactStore.ts").ArtifactRootInvalid
  | import("../security/Isolation.ts").IsolationFailure
  | import("../security/Submission.ts").SubmissionInvalid
  | import("../security/Verifier.ts").VerificationInvalid
  | import("./Workspace.ts").TaskBundleInvalid
  | import("effect/PlatformError").PlatformError

/** Loaded task carrying its own verifier into generic trial orchestration. */
export interface ReviewedTask<D extends TaskDefinition = TaskDefinition> extends TaskBase<D> {
  readonly verify: (
    submission: Submission.Submission,
  ) => Effect.Effect<TrialVerification, TaskVerificationError, TaskRequirements>
}
