import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Entrypoint from "../catalog/Entrypoint.ts"
import * as PackageManifest from "../catalog/PackageManifest.ts"
import { HarnessError } from "../HarnessError.ts"
import type { BunLock } from "./BunLock.ts"
import * as BunLockModel from "./BunLock.ts"
import type { RegistryPackage } from "../Domain.ts"

const failure = (operation: string, path: string, cause: unknown): HarnessError =>
  new HarnessError({ operation, path, cause })

const packageDirectory = (path: Path.Path, nodeModules: string, name: string): string =>
  path.join(nodeModules, ...name.split("/"))

const locate = Effect.fn("RegistryPackage.locate")(function* (
  nodeModulesPaths: ReadonlyArray<string>,
  name: string,
  expectedVersion: string,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  for (const nodeModules of nodeModulesPaths) {
    const directory = packageDirectory(path, nodeModules, name)
    if (yield* fs.exists(path.join(directory, "package.json"))) return directory

    const store = path.join(nodeModules, ".pnpm")
    if (!(yield* fs.exists(store))) continue
    const packagePrefix = `${name.replace("/", "+")}@`
    const version = expectedVersion.match(/\d+\.\d+\.\d+/)?.[0]
    const entries = yield* fs
      .readDirectory(store)
      .pipe(Effect.mapError((cause) => failure("list pnpm virtual store", store, cause)))
    const candidates = entries
      .filter(
        (entry) =>
          entry.startsWith(packagePrefix) &&
          (version === undefined || entry.startsWith(`${packagePrefix}${version}`)),
      )
      .toSorted()
    for (const entry of candidates) {
      const candidate = packageDirectory(path, path.join(store, entry, "node_modules"), name)
      if (yield* fs.exists(path.join(candidate, "package.json"))) return candidate
    }
  }
  return null
})

const files = Effect.fn("RegistryPackage.files")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const visit = (
    current: string,
    prefix: string,
  ): Effect.Effect<ReadonlyArray<string>, HarnessError> =>
    Effect.gen(function* () {
      const entries = yield* fs
        .readDirectory(current)
        .pipe(Effect.mapError((cause) => failure("list installed package", current, cause)))
      const discovered: Array<string> = []
      for (const entry of entries) {
        // A pnpm package directory can contain linked dependencies. They are not part of this
        // package's public files and recursively visiting them expands one package inspection
        // into its entire dependency graph.
        if (entry === "node_modules" || entry === ".git") continue
        const target = path.join(current, entry)
        const relative = path.join(prefix, entry)
        const info = yield* fs
          .stat(target)
          .pipe(Effect.mapError((cause) => failure("inspect installed package", target, cause)))
        if (info.type === "File") discovered.push(relative.replaceAll("\\", "/"))
        if (info.type === "Directory") discovered.push(...(yield* visit(target, relative)))
      }
      return discovered
    })
  return (yield* visit(directory, "")).toSorted()
})

/**
 * Finds and inspects an installed registry package at an exact expected version.
 *
 * @remarks
 * Search roots are ordered by authority. The first matching package is decoded,
 * fingerprinted through lock evidence, and expanded into catalog entrypoints.
 *
 * @param root - Better Native repository root.
 * @param nodeModulesPaths - Ordered package installation roots.
 * @param name - Package name to inspect.
 * @param expectedVersion - Exact version required by the pinned Expo catalog.
 * @param lock - Decoded Bun lockfile used to attach integrity evidence.
 * @returns Package metadata, or `null` when no exact installation exists.
 * @throws {@link HarnessError} when a discovered manifest cannot be read or decoded.
 */
export const inspect = Effect.fn("RegistryPackage.inspect")(function* (
  root: string,
  nodeModulesPaths: ReadonlyArray<string>,
  name: string,
  expectedVersion: string,
  lock: BunLock,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* locate(nodeModulesPaths, name, expectedVersion)
  if (directory === null) return null

  const manifestPath = path.join(directory, "package.json")
  const manifest = yield* fs.readFileString(manifestPath).pipe(
    Effect.mapError((cause) => failure("read installed package", manifestPath, cause)),
    Effect.flatMap((text) =>
      Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (cause) => failure("parse installed package", manifestPath, cause),
      }),
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(PackageManifest.PackageManifest)),
    Effect.mapError((cause) =>
      cause instanceof HarnessError
        ? cause
        : failure("decode installed package", manifestPath, cause),
    ),
  )
  const packageFiles = yield* files(directory)
  const manifestEntrypoints = Entrypoint.fromManifest(manifest)
  const entrypoints = (
    packageFiles.includes("app.plugin.js")
      ? Entrypoint.addConfigPlugin(manifest, manifestEntrypoints)
      : manifestEntrypoints
  ).toSorted((left, right) => left.subpath.localeCompare(right.subpath))

  return {
    version: manifest.version,
    packagePath: path.relative(root, directory),
    gitHead: manifest.gitHead ?? null,
    resolution: BunLockModel.resolution(lock, name, manifest.version),
    files: packageFiles,
    entrypoints,
  } satisfies RegistryPackage
})
