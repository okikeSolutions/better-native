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
  root: string,
  appRoot: string,
  name: string,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  for (const nodeModules of [path.join(appRoot, "node_modules"), path.join(root, "node_modules")]) {
    const directory = packageDirectory(path, nodeModules, name)
    if (yield* fs.exists(path.join(directory, "package.json"))) return directory
  }
  return null
})

const files = Effect.fn("RegistryPackage.files")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const entries = yield* fs
    .readDirectory(directory, { recursive: true })
    .pipe(Effect.mapError((cause) => failure("list installed package", directory, cause)))
  return yield* Effect.filter(
    entries,
    (entry) =>
      fs.stat(path.join(directory, entry)).pipe(
        Effect.map((info) => info.type === "File"),
        Effect.mapError((cause) => failure("inspect installed package", directory, cause)),
      ),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((matchedFiles) => matchedFiles.map((file) => file.replaceAll("\\", "/")).toSorted()),
  )
})

export const inspect = Effect.fn("RegistryPackage.inspect")(function* (
  root: string,
  appRoot: string,
  name: string,
  lock: BunLock,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* locate(root, appRoot, name)
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
