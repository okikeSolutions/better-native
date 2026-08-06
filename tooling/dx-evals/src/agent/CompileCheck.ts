import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Match from "effect/Match"
import type * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import type * as Config from "../Config.ts"
import * as Isolation from "../security/Isolation.ts"
import * as Submission from "../security/Submission.ts"
import * as Verifier from "../security/Verifier.ts"
import type * as TaskModel from "../tasks/TaskModel.ts"
import * as Workspace from "../tasks/Workspace.ts"
import type * as PackageArtifact from "../tasks/PackageArtifact.ts"

const CompileDiagnostic = Schema.Struct({
  code: Schema.Int,
  category: Schema.Literals(["error", "warning"]),
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Int),
  column: Schema.optional(Schema.Int),
  message: Schema.String,
})

const CompileObservation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("compile"),
  status: Schema.Literals(["passed", "failed"]),
  diagnostics: Schema.Array(CompileDiagnostic),
  truncated: Schema.Boolean,
})

/** Bounded compile result exposed to a coding agent. */
export const PublicCompileResult = Schema.Struct({
  status: Schema.Literals(["passed", "failed", "timeout", "unavailable"]),
  diagnostics: Schema.Array(CompileDiagnostic),
  truncated: Schema.Boolean,
})
export type PublicCompileResult = Schema.Schema.Type<typeof PublicCompileResult>

/** Stable result used when the public compiler boundary is unavailable. */
export const unavailable: PublicCompileResult = {
  status: "unavailable",
  diagnostics: [],
  truncated: false,
}

/** Stable result used when the bounded compiler reaches its isolation timeout. */
export const timedOut: PublicCompileResult = {
  status: "timeout",
  diagnostics: [],
  truncated: false,
}

/** Services captured once when constructing a task-aware public compiler callback. */
export type Requirements =
  | Config.DxEvalConfig
  | FileSystem.FileSystem
  | Path.Path
  | Isolation.Isolation
  | PackageArtifact.PackageArtifacts

/** Task-bound public compiler callback with all infrastructure captured by the adapter scope. */
export type Checker = (submission: Submission.Submission) => Effect.Effect<PublicCompileResult>

const run = (task: TaskModel.TaskBase, untrustedSubmission: Submission.Submission) =>
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
        runner: "check-types.ts",
        ...(task.definition.publicCompileContract === undefined
          ? {}
          : { publicCompileContract: task.definition.publicCompileContract }),
      })
      const parsed = yield* Verifier.parseObservation(isolated)
      const observation = yield* Schema.decodeUnknownEffect(CompileObservation)(parsed).pipe(
        Effect.mapError(
          () =>
            new Verifier.VerificationInvalid({
              reason: "invalid-compile-observation",
            }),
        ),
      )
      return {
        status: observation.status,
        diagnostics: observation.diagnostics,
        truncated: observation.truncated,
      } satisfies PublicCompileResult
    }),
  )

/**
 * Compiles current candidate edits without exposing private verification inputs. Expected
 * infrastructure failures collapse to bounded public statuses rather than leaking host details.
 */
export const checkSubmission = (
  task: TaskModel.TaskBase,
  submission: Submission.Submission,
): Effect.Effect<PublicCompileResult, never, Requirements> =>
  run(task, submission).pipe(
    Effect.catch((error) =>
      Match.value(error).pipe(
        Match.when({ _tag: "IsolationFailure", reason: "timeout" }, () => Effect.succeed(timedOut)),
        Match.orElse(() => Effect.succeed(unavailable)),
      ),
    ),
  )

/** Captures the managed runtime services needed by repeated `check_submission` tool calls. */
export const makeChecker = (
  task: TaskModel.TaskBase,
): Effect.Effect<Checker, never, Requirements> =>
  Effect.map(
    Effect.context<Requirements>(),
    (context) => (submission) => checkSubmission(task, submission).pipe(Effect.provide(context)),
  )
