import * as Cache from "effect/Cache"
import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import ts from "typescript"
import * as ArtifactStore from "../evidence/ArtifactStore.ts"
import * as Config from "../Config.ts"
import * as Domain from "../Domain.ts"
import type * as TaskModel from "./TaskModel.ts"

/** Failure raised when a repository-owned task bundle or package artifact is malformed. */
export class TaskBundleInvalid extends Data.TaggedError("TaskBundleInvalid")<{
  readonly reason: string
}> {}

const PackedPackageSpecSchema = Schema.Struct({
  taskName: Domain.NonEmptyString,
  packageDirectory: Domain.NonEmptyString,
  packageName: Domain.NonEmptyString,
  nativeDouble: Domain.NonEmptyString,
})

const PackageManifest = Schema.Struct({
  name: Schema.String,
  exports: Schema.Unknown,
})

/** One validated local package archive shared by agent discovery and clean-room execution. */
export interface PackedPackageArtifact {
  readonly spec: TaskModel.PackedPackageUnitSpec
  readonly archivePath: string
  readonly digest: Domain.Sha256Digest
  readonly manifestContent: string
  readonly publicFiles: ReadonlyArray<TaskModel.FixtureFile>
}

/** Managed package-artifact operations. */
export interface Service {
  readonly prepare: (
    spec: TaskModel.PackedPackageUnitSpec,
  ) => Effect.Effect<PackedPackageArtifact, TaskBundleInvalid | PlatformError.PlatformError>
  readonly install: (
    artifact: PackedPackageArtifact,
    workspace: string,
  ) => Effect.Effect<string, TaskBundleInvalid | PlatformError.PlatformError>
}

/** Process-scoped cache of validated `bun pm pack` artifacts. */
export class PackageArtifacts extends Context.Service<PackageArtifacts, Service>()(
  "@better-native/dx-evals/PackageArtifacts",
) {}

const parseJson = (value: string, reason: string): Effect.Effect<unknown, TaskBundleInvalid> =>
  Effect.try({
    try: () => JSON.parse(value) as unknown,
    catch: () => new TaskBundleInvalid({ reason }),
  })

const decodeSpec = (encoded: string) =>
  parseJson(encoded, "invalid-packed-package-cache-key").pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PackedPackageSpecSchema)),
    Effect.mapError(() => new TaskBundleInvalid({ reason: "invalid-packed-package-cache-key" })),
  )

const specKey = (spec: TaskModel.PackedPackageUnitSpec): string =>
  JSON.stringify({
    taskName: spec.taskName,
    packageDirectory: spec.packageDirectory,
    packageName: spec.packageName,
    nativeDouble: spec.nativeDouble,
  })

const runTrustedCommand = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  command: ChildProcess.Command,
  reason: string,
): Effect.Effect<string, TaskBundleInvalid> =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner
        .spawn(command)
        .pipe(Effect.mapError(() => new TaskBundleInvalid({ reason })))
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          Stream.mkString(handle.stdout.pipe(Stream.decodeText())),
          Stream.mkString(handle.stderr.pipe(Stream.decodeText())),
          handle.exitCode,
        ] as const,
        { concurrency: "unbounded" },
      ).pipe(Effect.mapError(() => new TaskBundleInvalid({ reason })))
      if (Number(exitCode) !== 0) {
        return yield* new TaskBundleInvalid({
          reason: `${reason}:exit=${Number(exitCode)}:stderr=${JSON.stringify(stderr.slice(0, 4_096))}`,
        })
      }
      return stdout
    }),
  )

const isSafePackagePath = (value: string): boolean =>
  value.length > 0 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")

/** Validates archive names and entry types before extraction. */
export const validateArchiveListing = (
  taskName: string,
  listing: string,
  verboseListing: string,
): Effect.Effect<ReadonlySet<string>, TaskBundleInvalid> => {
  const archiveEntries = listing.split("\n").filter((entry) => entry.length > 0)
  const unsafeName = archiveEntries.some(
    (entry) => !entry.startsWith("package/") || !isSafePackagePath(entry.slice("package/".length)),
  )
  const unsafeType = verboseListing
    .split("\n")
    .filter((entry) => entry.length > 0)
    .some((entry) => entry[0] !== "-" && entry[0] !== "d")
  const relativeEntries = archiveEntries.map((entry) => entry.slice("package/".length))
  return archiveEntries.length === 0 ||
    unsafeName ||
    unsafeType ||
    !relativeEntries.includes("package.json")
    ? Effect.fail(new TaskBundleInvalid({ reason: `unsafe-${taskName}-package-archive` }))
    : Effect.succeed(new Set(relativeEntries))
}

interface ExportTarget {
  readonly condition: string | null
  readonly target: string
}

const collectExportTargets = (
  value: unknown,
  condition: string | null = null,
): ReadonlyArray<ExportTarget> =>
  Match.value(value).pipe(
    Match.when(Match.string, (target) => [{ condition, target }]),
    Match.when(
      (candidate: unknown): candidate is ReadonlyArray<unknown> => Array.isArray(candidate),
      (values) => values.flatMap((entry) => collectExportTargets(entry, condition)),
    ),
    Match.when(
      (candidate: unknown): candidate is Record<string, unknown> =>
        typeof candidate === "object" && candidate !== null,
      (record) =>
        Object.entries(record).flatMap(([key, entry]) =>
          collectExportTargets(entry, key === "types" ? "types" : condition),
        ),
    ),
    Match.orElse(() => []),
  )

const exportTargetPath = (
  taskName: string,
  target: string,
): Effect.Effect<string, TaskBundleInvalid> => {
  if (!target.startsWith("./")) {
    return Effect.fail(
      new TaskBundleInvalid({ reason: `unsafe-${taskName}-package-export-target` }),
    )
  }
  const relative = target.slice(2)
  return isSafePackagePath(relative)
    ? Effect.succeed(relative)
    : Effect.fail(new TaskBundleInvalid({ reason: `unsafe-${taskName}-package-export-target` }))
}

const normalizeRelativeReference = (
  taskName: string,
  declarationPath: string,
  reference: string,
): Effect.Effect<string, TaskBundleInvalid> => {
  const base = declarationPath.split("/").slice(0, -1)
  const resolved = [...base]
  for (const segment of reference.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (resolved.length === 0) {
        return Effect.fail(
          new TaskBundleInvalid({ reason: `escaping-${taskName}-declaration-reference` }),
        )
      }
      resolved.pop()
      continue
    }
    if (segment.includes("\\") || segment.includes("\0")) {
      return Effect.fail(
        new TaskBundleInvalid({ reason: `escaping-${taskName}-declaration-reference` }),
      )
    }
    resolved.push(segment)
  }
  const normalized = resolved.join("/")
  return isSafePackagePath(normalized)
    ? Effect.succeed(normalized)
    : Effect.fail(new TaskBundleInvalid({ reason: `escaping-${taskName}-declaration-reference` }))
}

const declarationCandidates = (normalized: string): ReadonlyArray<string> => {
  if (/\.d\.(?:ts|mts|cts)$/.test(normalized)) return [normalized]
  if (/\.(?:mts|mjs)$/.test(normalized)) {
    return [normalized.replace(/\.(?:mts|mjs)$/, ".d.mts")]
  }
  if (/\.(?:cts|cjs)$/.test(normalized)) {
    return [normalized.replace(/\.(?:cts|cjs)$/, ".d.cts")]
  }
  if (/\.(?:ts|tsx|js|jsx)$/.test(normalized)) {
    return [normalized.replace(/\.(?:ts|tsx|js|jsx)$/, ".d.ts")]
  }
  return [
    `${normalized}.d.ts`,
    `${normalized}.d.mts`,
    `${normalized}.d.cts`,
    `${normalized}/index.d.ts`,
  ]
}

const resolveDeclarationReference = (
  spec: TaskModel.PackedPackageSpec,
  entries: ReadonlySet<string>,
  declarationPath: string,
  reference: string,
): Effect.Effect<string, TaskBundleInvalid> =>
  normalizeRelativeReference(spec.taskName, declarationPath, reference).pipe(
    Effect.flatMap((normalized) => {
      const resolved = declarationCandidates(normalized).find((candidate) => entries.has(candidate))
      return resolved === undefined
        ? Effect.fail(
            new TaskBundleInvalid({
              reason: `missing-${spec.taskName}-declaration-reference:${declarationPath}:${reference}`,
            }),
          )
        : Effect.succeed(resolved)
    }),
  )

/**
 * Validates package exports and returns only the manifest plus the reachable public declaration
 * graph. Runtime JavaScript and repository-private files are intentionally excluded.
 */
export const validatePublicPackageSurface = (
  spec: TaskModel.PackedPackageSpec,
  entries: ReadonlySet<string>,
  readText: (relativePath: string) => Effect.Effect<string, TaskBundleInvalid>,
): Effect.Effect<
  { readonly manifestContent: string; readonly publicFiles: ReadonlyArray<TaskModel.FixtureFile> },
  TaskBundleInvalid
> =>
  Effect.gen(function* () {
    const containsPrivateEntry = [...entries].some((entry) => {
      const segments = entry.split("/")
      const fileName = segments.at(-1)
      return (
        segments.includes("src") ||
        segments.includes("grader") ||
        fileName === "reference.patch" ||
        fileName === "broken.patch"
      )
    })
    if (containsPrivateEntry) {
      return yield* new TaskBundleInvalid({ reason: `private-${spec.taskName}-package-entry` })
    }
    const manifestContent = yield* readText("package.json")
    const manifest = yield* parseJson(
      manifestContent,
      `invalid-packed-${spec.taskName}-manifest`,
    ).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(PackageManifest)),
      Effect.mapError(
        () => new TaskBundleInvalid({ reason: `invalid-packed-${spec.taskName}-manifest` }),
      ),
    )
    if (manifest.name !== spec.packageName) {
      return yield* new TaskBundleInvalid({ reason: `invalid-packed-${spec.taskName}-name` })
    }
    const exportTargets = collectExportTargets(manifest.exports)
    const rootExports =
      typeof manifest.exports === "object" &&
      manifest.exports !== null &&
      !Array.isArray(manifest.exports) &&
      "." in manifest.exports
        ? (manifest.exports as Record<string, unknown>)["."]
        : manifest.exports
    const rootTypeTargets = collectExportTargets(rootExports).filter(
      (target) => target.condition === "types",
    )
    const typeTargets = exportTargets.filter((target) => target.condition === "types")
    if (exportTargets.length === 0 || rootTypeTargets.length === 0 || typeTargets.length === 0) {
      return yield* new TaskBundleInvalid({
        reason: `missing-${spec.taskName}-package-types-export`,
      })
    }
    const resolvedTargets = yield* Effect.forEach(exportTargets, (entry) =>
      exportTargetPath(spec.taskName, entry.target).pipe(
        Effect.tap((relativePath) =>
          entries.has(relativePath)
            ? readText(relativePath).pipe(Effect.asVoid)
            : Effect.fail(
                new TaskBundleInvalid({
                  reason: `missing-${spec.taskName}-package-export:${entry.target}`,
                }),
              ),
        ),
        Effect.map((relativePath) => ({ ...entry, relativePath })),
      ),
    )
    const queue = resolvedTargets
      .filter((target) => target.condition === "types")
      .map((target) => target.relativePath)
    const declarations = new Map<string, string>()
    while (queue.length > 0) {
      const declarationPath = queue.shift()!
      if (declarations.has(declarationPath)) continue
      const content = yield* readText(declarationPath)
      declarations.set(declarationPath, content)
      const preprocessed = ts.preProcessFile(content, true, true)
      const references = [...preprocessed.importedFiles, ...preprocessed.referencedFiles].map(
        (reference) => reference.fileName,
      )
      for (const reference of references) {
        if (!reference.startsWith(".")) continue
        queue.push(yield* resolveDeclarationReference(spec, entries, declarationPath, reference))
      }
    }
    return {
      manifestContent,
      publicFiles: [
        { path: Domain.TaskRelativePath.make("package.json"), content: manifestContent },
        ...[...declarations.entries()]
          .toSorted(([left], [right]) => (left < right ? -1 : Number(left > right)))
          .map(([path, content]) => ({ path: Domain.TaskRelativePath.make(path), content })),
      ],
    }
  })

const sha256 = (
  crypto: Crypto.Crypto,
  bytes: Uint8Array,
  reason: string,
): Effect.Effect<Domain.Sha256Digest, TaskBundleInvalid> =>
  crypto.digest("SHA-256", bytes).pipe(
    Effect.map((digest) =>
      Domain.Sha256Digest.make(
        Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      ),
    ),
    Effect.mapError(() => new TaskBundleInvalid({ reason })),
  )

/** Managed layer that packs each distinct package specification exactly once. */
export const layer = Layer.effect(
  PackageArtifacts,
  Effect.gen(function* () {
    const config = yield* Config.DxEvalConfig
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const crypto = yield* Crypto.Crypto
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const preparationRoot = yield* ArtifactStore.ensureDirectory("package-preparation")
    const cacheRoot = yield* fs.makeTempDirectoryScoped({
      directory: preparationRoot,
      prefix: "artifacts-",
    })

    const prepare = (spec: TaskModel.PackedPackageUnitSpec) =>
      Effect.gen(function* () {
        const packageRoot = path.join(config.repositoryRoot, "packages", spec.packageDirectory)
        const scratch = yield* fs.makeTempDirectory({
          directory: cacheRoot,
          prefix: `${spec.taskName}-pack-`,
        })
        yield* runTrustedCommand(
          spawner,
          ChildProcess.make(
            config.bunExecutable,
            ["pm", "pack", "--ignore-scripts", "--destination", scratch, "--quiet"],
            { cwd: packageRoot },
          ),
          `${spec.taskName}-package-pack-failed`,
        )
        const archiveNames = (yield* fs.readDirectory(scratch)).filter((name) =>
          name.endsWith(".tgz"),
        )
        if (archiveNames.length !== 1) {
          return yield* new TaskBundleInvalid({
            reason: `${spec.taskName}-package-archive-not-produced`,
          })
        }
        const archiveName = archiveNames[0]
        if (archiveName === undefined) {
          return yield* new TaskBundleInvalid({
            reason: `${spec.taskName}-package-archive-not-produced`,
          })
        }
        const archivePath = path.join(scratch, archiveName)
        const [listing, verboseListing] = yield* Effect.all([
          runTrustedCommand(
            spawner,
            ChildProcess.make(config.tarExecutable, ["-tzf", archivePath]),
            `${spec.taskName}-package-list-failed`,
          ),
          runTrustedCommand(
            spawner,
            ChildProcess.make(config.tarExecutable, ["-tvzf", archivePath]),
            `${spec.taskName}-package-type-list-failed`,
          ),
        ])
        const entries = yield* validateArchiveListing(spec.taskName, listing, verboseListing)
        const extractedRoot = path.join(scratch, "extracted")
        yield* fs.makeDirectory(extractedRoot)
        yield* runTrustedCommand(
          spawner,
          ChildProcess.make(config.tarExecutable, [
            "-xzf",
            archivePath,
            "--strip-components=1",
            "--no-same-owner",
            "--no-same-permissions",
            "-C",
            extractedRoot,
          ]),
          `${spec.taskName}-package-extract-failed`,
        )
        const readText = (relativePath: string) =>
          fs.readFileString(path.join(extractedRoot, relativePath)).pipe(
            Effect.mapError(
              () =>
                new TaskBundleInvalid({
                  reason: `unreadable-${spec.taskName}-package-entry:${relativePath}`,
                }),
            ),
          )
        const surface = yield* validatePublicPackageSurface(spec, entries, readText)
        const digest = yield* sha256(
          crypto,
          yield* fs.readFile(archivePath),
          `${spec.taskName}-package-digest-failed`,
        )
        return {
          spec,
          archivePath,
          digest,
          manifestContent: surface.manifestContent,
          publicFiles: surface.publicFiles,
        } satisfies PackedPackageArtifact
      })

    const cache = yield* Cache.make({
      capacity: 32,
      lookup: (encodedSpec: string) => decodeSpec(encodedSpec).pipe(Effect.flatMap(prepare)),
    })

    return PackageArtifacts.of({
      prepare: (spec) => Cache.get(cache, specKey(spec)),
      install: (artifact, workspace) =>
        Effect.gen(function* () {
          const installedRoot = path.join(
            workspace,
            "node_modules",
            ...artifact.spec.packageName.split("/"),
          )
          yield* fs.makeDirectory(installedRoot, { recursive: true })
          yield* runTrustedCommand(
            spawner,
            ChildProcess.make(config.tarExecutable, [
              "-xzf",
              artifact.archivePath,
              "--strip-components=1",
              "--no-same-owner",
              "--no-same-permissions",
              "-C",
              installedRoot,
            ]),
            `${artifact.spec.taskName}-package-install-failed`,
          )
          const installedManifest = yield* fs.readFileString(
            path.join(installedRoot, "package.json"),
          )
          if (installedManifest !== artifact.manifestContent) {
            return yield* new TaskBundleInvalid({
              reason: `${artifact.spec.taskName}-installed-package-mismatch`,
            })
          }
          return installedRoot
        }),
    })
  }),
)
