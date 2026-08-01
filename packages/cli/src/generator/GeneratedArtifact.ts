import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"

class GeneratedArtifactSecurityError extends Data.TaggedError("GeneratedArtifactSecurityError")<{
  readonly path: string
  readonly reason: string
}> {}

const isContained = (path: Path.Path, root: string, target: string): boolean => {
  const relative = path.relative(root, target)
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  )
}

const resolveArtifact = (artifactPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(".")
    const target = path.resolve(root, artifactPath)
    const parent = path.dirname(target)

    if (!isContained(path, root, target)) {
      return yield* new GeneratedArtifactSecurityError({
        path: artifactPath,
        reason: "Artifact path escapes the workspace"
      })
    }

    const canonicalParent = yield* fs.realPath(parent)
    if (canonicalParent !== parent || !isContained(path, root, canonicalParent)) {
      return yield* new GeneratedArtifactSecurityError({
        path: artifactPath,
        reason: "Artifact parent must be a real directory inside the workspace"
      })
    }

    const exists = yield* fs.exists(target)
    if (exists) {
      const canonicalTarget = yield* fs.realPath(target)
      if (canonicalTarget !== target || !isContained(path, root, canonicalTarget)) {
        return yield* new GeneratedArtifactSecurityError({
          path: artifactPath,
          reason: "Artifact target must be a regular workspace path, not a symbolic link"
        })
      }
      const info = yield* fs.stat(target)
      if (info.type !== "File") {
        return yield* new GeneratedArtifactSecurityError({
          path: artifactPath,
          reason: "Artifact target must be a regular file"
        })
      }
    }

    return { parent, target, exists }
  })

export const readGeneratedArtifact = (artifactPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    if (!(yield* fs.exists(artifactPath))) return undefined
    const artifact = yield* resolveArtifact(artifactPath)
    return yield* fs.readFileString(artifact.target)
  })

export const writeGeneratedArtifact = (artifactPath: string, source: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const initial = yield* resolveArtifact(artifactPath)
      const temporary = yield* fs.makeTempFileScoped({
        directory: initial.parent,
        prefix: ".effect-expo-",
        suffix: ".tmp"
      })
      yield* fs.writeFileString(temporary, source)
      const final = yield* resolveArtifact(artifactPath)
      if (final.parent !== initial.parent || final.target !== initial.target) {
        return yield* new GeneratedArtifactSecurityError({
          path: artifactPath,
          reason: "Artifact path changed during generation"
        })
      }
      yield* fs.rename(temporary, final.target)
    })
  )
