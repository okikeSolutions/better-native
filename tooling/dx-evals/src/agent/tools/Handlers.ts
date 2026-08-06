import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as CompileCheck from "../CompileCheck.ts"
import * as Domain from "../../Domain.ts"
import * as Submission from "../../security/Submission.ts"
import type * as TaskWorkspace from "../../tasks/TaskWorkspace.ts"
import { CodingToolkit } from "./Toolkit.ts"
import * as VirtualWorkspace from "./VirtualWorkspace.ts"

/** Public compile callback supplied by the task-aware adapter boundary. */
export type CheckSubmissionHandler = (
  submission: Submission.Submission,
) => Effect.Effect<CompileCheck.PublicCompileResult>

export interface WorkspaceState {
  readonly files: ReadonlyMap<string, string>
  readonly originals: ReadonlyMap<string, string>
  readonly editablePaths: ReadonlySet<Domain.TaskRelativePath>
  readonly submitted: boolean
}

/** Creates isolated mutable state for one agent trial. */
export const makeState = (seed: TaskWorkspace.AgentWorkspaceSeed): WorkspaceState => {
  const originalFiles = new Map(seed.files.map((file) => [file.path as string, file.content]))
  return {
    files: originalFiles,
    originals: originalFiles,
    editablePaths: seed.editablePaths,
    submitted: false,
  }
}

/** Projects only changed editable files into a submission. */
export const makeSubmission = (state: WorkspaceState): Submission.Submission => ({
  entries: [...state.files.entries()]
    .filter(
      ([path, content]) =>
        state.editablePaths.has(Domain.TaskRelativePath.make(path)) &&
        state.originals.get(path) !== content,
    )
    .map(([path, content]) => ({ kind: "file" as const, path, content })),
})

/** Builds the Effect AI handler layer over one allowlisted virtual workspace. */
export const makeHandlers = (
  workspace: Ref.Ref<WorkspaceState>,
  checkSubmission: CheckSubmissionHandler,
  limits: VirtualWorkspace.Limits,
) =>
  CodingToolkit.toLayer({
    ls: (request) =>
      Ref.get(workspace).pipe(
        Effect.map((state) => VirtualWorkspace.list(state.files, request, limits)),
      ),
    find: (request) =>
      Ref.get(workspace).pipe(
        Effect.map((state) => VirtualWorkspace.find(state.files, request, limits)),
      ),
    read: (request) =>
      Ref.get(workspace).pipe(
        Effect.map((state) => VirtualWorkspace.read(state.files, request, limits)),
      ),
    grep: (request) =>
      Ref.get(workspace).pipe(
        Effect.map((state) => VirtualWorkspace.search(state.files, request, limits)),
      ),
    edit: (request) =>
      Effect.gen(function* () {
        const { path } = request
        const state = yield* Ref.get(workspace)
        if (!Schema.is(Domain.TaskRelativePath)(path)) {
          return { ok: false, error: "unsafe-path" }
        }
        const relativePath = Domain.TaskRelativePath.make(path)
        if (!state.editablePaths.has(relativePath)) {
          return { ok: false, error: "path-not-editable" }
        }
        const content = state.files.get(path)
        if (content === undefined) return { ok: false, error: "file-not-found" }
        const result = VirtualWorkspace.edit(content, request, limits)
        return yield* Match.value(result).pipe(
          Match.when({ ok: false }, (failure) => Effect.succeed(failure)),
          Match.when({ ok: true }, (success) =>
            Effect.gen(function* () {
              if (new TextEncoder().encode(success.content).byteLength > 64 * 1_024) {
                return { ok: false as const, error: "file-size-limit" }
              }
              const files = new Map(state.files)
              files.set(path, success.content)
              yield* Ref.set(workspace, { ...state, files })
              return {
                ok: true as const,
                content: `updated (${success.replacements} replacements)`,
              }
            }),
          ),
          Match.exhaustive,
        )
      }),
    write: ({ path, content }) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(workspace)
        if (!Schema.is(Domain.TaskRelativePath)(path)) {
          return { ok: false, error: "unsafe-path" }
        }
        const relativePath = Domain.TaskRelativePath.make(path)
        if (!state.editablePaths.has(relativePath)) {
          return { ok: false, error: "path-not-editable" }
        }
        if (new TextEncoder().encode(content).byteLength > 64 * 1_024) {
          return { ok: false, error: "file-size-limit" }
        }
        const files = new Map(state.files)
        files.set(path, content)
        yield* Ref.set(workspace, { ...state, files })
        return { ok: true, content: "updated" }
      }),
    check_submission: () =>
      Ref.get(workspace).pipe(Effect.flatMap((state) => checkSubmission(makeSubmission(state)))),
    submit: () =>
      Ref.update(workspace, (state) => ({ ...state, submitted: true })).pipe(
        Effect.as({ submitted: true }),
      ),
  })
