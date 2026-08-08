import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Config from "../Config.ts"

/** Failure raised when the artifact root is redirected or cannot be secured. */
export class ArtifactRootInvalid extends Data.TaggedError("ArtifactRootInvalid")<{
  readonly reason: string
}> {}

const rejectSymbolicLink = (fs: FileSystem.FileSystem, target: string, reason: string) =>
  Effect.gen(function* () {
    const linkTarget = yield* Effect.option(fs.readLink(target))
    if (Option.isSome(linkTarget)) return yield* new ArtifactRootInvalid({ reason })
  })

const ensureDirectoryEntry = (fs: FileSystem.FileSystem, target: string, linkReason: string) =>
  Effect.gen(function* () {
    // readLink observes a link without following it, including a dangling link. Check both before
    // and after creation so pre-existing redirections fail before child paths are created.
    yield* rejectSymbolicLink(fs, target, linkReason)
    // Recursive mkdir is idempotent when independent eval workers create the same reviewed root.
    // The link and directory-type checks on both sides retain the fail-closed path policy.
    yield* fs.makeDirectory(target, { mode: 0o700, recursive: true })
    yield* rejectSymbolicLink(fs, target, linkReason)
    const info = yield* fs.stat(target)
    if (info.type !== "Directory") {
      return yield* new ArtifactRootInvalid({ reason: "artifact-path-must-be-a-directory" })
    }
  })

const safeSegments = (relativePath: string): ReadonlyArray<string> | undefined => {
  if (relativePath.length === 0 || relativePath.includes("\\") || relativePath.includes("\0")) {
    return undefined
  }
  const segments = relativePath.split("/")
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    ? segments
    : undefined
}

/** Creates and validates the controller-owned artifact root without following existing links. */
export const ensureRoot = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const repository = path.resolve(config.repositoryRoot)
  const artifactRoot = path.resolve(config.artifactsRoot)
  const relative = path.relative(repository, artifactRoot)
  const segments = safeSegments(relative)
  if (segments === undefined) {
    return yield* new ArtifactRootInvalid({ reason: "artifact-root-escaped-repository" })
  }

  let cursor = repository
  for (const segment of segments) {
    cursor = path.join(cursor, segment)
    yield* ensureDirectoryEntry(fs, cursor, "artifact-root-must-not-contain-a-symlink")
  }

  const repositoryReal = yield* fs.realPath(repository)
  const expectedReal = path.resolve(repositoryReal, relative)
  const real = yield* fs.realPath(artifactRoot)
  if (real !== expectedReal) {
    return yield* new ArtifactRootInvalid({ reason: "artifact-root-must-not-be-a-symlink" })
  }
  return real
}).pipe(
  Effect.mapError((cause) =>
    cause instanceof ArtifactRootInvalid
      ? cause
      : new ArtifactRootInvalid({ reason: `artifact-root-validation-failed:${String(cause)}` }),
  ),
)

/** Creates one controller-owned artifact subdirectory and rejects link redirection at every step. */
export const ensureDirectory = (relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* ensureRoot
    const segments = safeSegments(relativePath)
    if (segments === undefined) {
      return yield* new ArtifactRootInvalid({ reason: "artifact-subdirectory-escaped-root" })
    }

    let target = root
    for (const segment of segments) {
      target = path.join(target, segment)
      yield* ensureDirectoryEntry(fs, target, "artifact-subdirectory-must-not-contain-a-symlink")
    }

    // Revalidate the root as well as the leaf immediately before returning the pathname. Effect's
    // FileSystem abstraction has no descriptor-relative openat API, so callers still assume that a
    // same-UID host process does not swap components after this check.
    if ((yield* fs.realPath(root)) !== root || (yield* fs.realPath(target)) !== target) {
      return yield* new ArtifactRootInvalid({
        reason: "artifact-subdirectory-must-not-be-a-symlink",
      })
    }
    return target
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof ArtifactRootInvalid
        ? cause
        : new ArtifactRootInvalid({
            reason: `artifact-subdirectory-validation-failed:${String(cause)}`,
          }),
    ),
  )
