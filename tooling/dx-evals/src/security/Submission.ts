import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as Domain from "../Domain.ts"

/** One changed filesystem entry returned by an adapter. */
export interface SubmissionEntry {
  readonly kind: "file" | "symlink" | "hardlink" | "special"
  readonly path: string
  readonly content: string
}

/** Validated collection of changed regular files. */
export interface Submission {
  readonly entries: ReadonlyArray<SubmissionEntry>
}

/** Regular file entry whose relative path has crossed the validation boundary. */
export interface ValidatedSubmissionEntry {
  readonly kind: "file"
  readonly path: Domain.TaskRelativePath
  readonly content: string
}

/** Submission safe to materialize inside a clean-room workspace. */
export interface ValidatedSubmission {
  readonly entries: ReadonlyArray<ValidatedSubmissionEntry>
}

/** Limits and path allowlist applied before reconstructing a candidate workspace. */
export interface SubmissionPolicy {
  readonly allowedPaths: ReadonlySet<Domain.TaskRelativePath>
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
}

/** Rejection raised for an unsafe or out-of-contract submission. */
export class SubmissionInvalid extends Data.TaggedError("SubmissionInvalid")<{
  readonly reason: string
}> {}

const utf8Size = (value: string): number => new TextEncoder().encode(value).byteLength

/** Validates entry kinds, normalized paths, collisions, allowlists, and byte limits. */
export const validateSubmission = (
  submission: Submission,
  policy: SubmissionPolicy,
): Effect.Effect<ValidatedSubmission, SubmissionInvalid> =>
  Effect.gen(function* () {
    if (submission.entries.length > policy.maxFiles) {
      return yield* new SubmissionInvalid({ reason: "file-count-limit" })
    }

    const paths = new Set<string>()
    const caseFoldedPaths = new Set<string>()
    const validatedEntries: Array<ValidatedSubmissionEntry> = []
    let totalBytes = 0
    for (const entry of submission.entries) {
      yield* Match.value(entry.kind).pipe(
        Match.when("file", () => Effect.void),
        Match.whenOr("symlink", "hardlink", "special", () =>
          Effect.fail(new SubmissionInvalid({ reason: `non-regular-entry:${entry.path}` })),
        ),
        Match.exhaustive,
      )
      if (!Schema.is(Domain.TaskRelativePath)(entry.path)) {
        return yield* new SubmissionInvalid({ reason: `unsafe-path:${entry.path}` })
      }
      const path = Domain.TaskRelativePath.make(entry.path)
      if (!policy.allowedPaths.has(path)) {
        return yield* new SubmissionInvalid({ reason: `path-not-allowed:${entry.path}` })
      }
      const folded = entry.path.toLocaleLowerCase("en-US")
      if (paths.has(entry.path) || caseFoldedPaths.has(folded)) {
        return yield* new SubmissionInvalid({ reason: `path-collision:${entry.path}` })
      }
      paths.add(entry.path)
      caseFoldedPaths.add(folded)
      const bytes = utf8Size(entry.content)
      if (bytes > policy.maxFileBytes) {
        return yield* new SubmissionInvalid({ reason: `file-size-limit:${entry.path}` })
      }
      totalBytes += bytes
      if (totalBytes > policy.maxTotalBytes) {
        return yield* new SubmissionInvalid({ reason: "total-size-limit" })
      }
      validatedEntries.push({ kind: "file", path, content: entry.content })
    }
    return { entries: validatedEntries }
  })

/** Strictly applies the single-file unified patch format used by synthetic fixtures. */
export const applySingleFilePatch = (
  original: string,
  patch: string,
  expectedPath: Domain.TaskRelativePath,
): Effect.Effect<string, SubmissionInvalid> =>
  Effect.gen(function* () {
    const lines = patch.replace(/\r\n/g, "\n").split("\n")
    if (lines.at(-1) === "") lines.pop()
    if (lines[0] !== `--- a/${expectedPath}` || lines[1] !== `+++ b/${expectedPath}`) {
      return yield* new SubmissionInvalid({ reason: "patch-target-mismatch" })
    }
    const match = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(lines[2] ?? "")
    if (match === null || match[1] !== "1" || match[3] !== "1") {
      return yield* new SubmissionInvalid({ reason: "unsupported-patch-hunk" })
    }
    const source = original.replace(/\r\n/g, "\n").split("\n")
    if (source.at(-1) === "") source.pop()
    const result: Array<string> = []
    let sourceIndex = 0
    for (const line of lines.slice(3)) {
      const marker = line[0]
      const content = line.slice(1)
      yield* Match.value(marker).pipe(
        Match.whenOr(" ", "-", (matchedMarker) =>
          Effect.gen(function* () {
            if (source[sourceIndex] !== content) {
              return yield* new SubmissionInvalid({ reason: "patch-context-mismatch" })
            }
            sourceIndex += 1
            return yield* Match.value(matchedMarker).pipe(
              Match.when(" ", () =>
                Effect.sync(() => {
                  result.push(content)
                }),
              ),
              Match.when("-", () => Effect.void),
              Match.exhaustive,
            )
          }),
        ),
        Match.when("+", () =>
          Effect.sync(() => {
            result.push(content)
          }),
        ),
        Match.orElse(() =>
          Effect.fail(new SubmissionInvalid({ reason: "unsupported-patch-line" })),
        ),
      )
    }
    if (
      sourceIndex !== source.length ||
      Number(match[2]) !== source.length ||
      Number(match[4]) !== result.length
    ) {
      return yield* new SubmissionInvalid({ reason: "patch-hunk-count-mismatch" })
    }
    return `${result.join("\n")}\n`
  })
