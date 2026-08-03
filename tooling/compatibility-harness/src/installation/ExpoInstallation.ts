import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import semver from "semver"
import type {
  Catalog,
  ExpoInstallation,
  InstalledPackage,
  PackageName,
  PackageResolution,
} from "../Domain.ts"
import { ExpoRepository } from "../ExpoRepository.ts"
import { HarnessError } from "../HarnessError.ts"
import * as PackageManifest from "../catalog/PackageManifest.ts"
import * as BunLock from "./BunLock.ts"
import * as RegistryPackage from "./RegistryPackage.ts"
import * as WildcardExports from "./WildcardExports.ts"

const AppManifest = Schema.Struct({
  dependencies: Schema.Record(Schema.String, Schema.String),
})

const failure = (operation: string, path: string | undefined, cause: unknown): HarnessError =>
  new HarnessError({ operation, ...(path === undefined ? {} : { path }), cause })

export const statusOf = (options: {
  readonly installedVersion: string | null
  readonly expectedVersion: string
  readonly declaredVersion: string | undefined
  readonly resolution: PackageResolution | null
  readonly requiresDeclaration?: boolean
}): InstalledPackage["status"] => {
  if (options.installedVersion === null) return "missing"
  if (options.requiresDeclaration ?? true) {
    if (options.declaredVersion === undefined) return "not-declared"
    if (options.declaredVersion !== options.expectedVersion) return "version-mismatch"
  }
  if (
    !semver.satisfies(options.installedVersion, options.expectedVersion, {
      includePrerelease: true,
    })
  ) {
    return "version-mismatch"
  }
  if (options.resolution === null) return "unlocked"
  return "valid"
}

const expectedPackages = (
  catalog: Catalog,
): ReadonlyArray<{ readonly name: PackageName; readonly version: string }> =>
  catalog.packages
    .flatMap((entry) => {
      if (entry.name === "expo") return [{ name: entry.name, version: entry.version }]
      return entry.bundledVersion === null
        ? []
        : [{ name: entry.name, version: entry.bundledVersion }]
    })
    .toSorted((left, right) => left.name.localeCompare(right.name))

const filesBelow = (files: ReadonlyArray<string>, directory: string): ReadonlyArray<string> => {
  const prefix = `${directory}/`
  return files
    .filter((file) => file.startsWith(prefix))
    .map((file) => file.slice(prefix.length))
    .toSorted()
}

export const inspect = Effect.fn("ExpoInstallation.inspect")(function* (catalog: Catalog) {
  const repository = yield* ExpoRepository
  const path = yield* Path.Path
  const lock = yield* BunLock.read(path.join(repository.root, "bun.lock"))
  const appManifest = yield* repository.readJson(
    "apps/compatibility-suite/package.json",
    AppManifest,
  )
  const lockfileHash = yield* repository.hashString(JSON.stringify(lock))
  const appRoot = path.join(repository.root, "apps/compatibility-suite")
  const catalogRoot = path.join(repository.root, "tooling/expo-catalog")
  const fixtureNodeModules = path.join(appRoot, "node_modules")
  const catalogNodeModules = path.join(catalogRoot, "node_modules")
  const repositoryNodeModules = path.join(repository.root, "node_modules")
  const expoNodeModules = path.join(repository.expoRoot, "node_modules")
  const catalogByName = new Map(catalog.packages.map((entry) => [entry.name as string, entry]))
  const expoFiles = yield* repository.expoFiles

  const packages = yield* Effect.forEach(
    expectedPackages(catalog),
    ({ name, version: expectedVersion }) =>
      Effect.gen(function* () {
        const declaredVersion = appManifest.dependencies[name]
        const catalogPackage = catalogByName.get(name)
        if (catalogPackage === undefined) {
          return yield* failure(
            "resolve Expo target package",
            undefined,
            `${name} is absent from the generated catalog`,
          )
        }
        const targetSource = catalogPackage.manifestPath === null ? "installed-external" : "pinned"
        // Expo's normal installation is authoritative for packages that are bundled into the
        // SDK but have no source directory in its repository. Keeping that installation ahead
        // of the runner's dependencies preserves the complete Expo surface without turning one
        // native fixture into an autolinked installation of every third-party module.
        const installed = yield* RegistryPackage.inspect(
          repository.root,
          targetSource === "installed-external"
            ? [expoNodeModules, catalogNodeModules, fixtureNodeModules, repositoryNodeModules]
            : [fixtureNodeModules, catalogNodeModules, repositoryNodeModules, expoNodeModules],
          name,
          expectedVersion,
          lock,
        )
        const status = statusOf({
          installedVersion: installed?.version ?? null,
          expectedVersion,
          declaredVersion,
          resolution: installed?.resolution ?? null,
          // The compatibility suite is deliberately a minimal fixture. The catalog verifies
          // that every target can be resolved from its installation, not that every target is
          // declared by this one native binary.
          requiresDeclaration: false,
        })
        const pinnedDirectory =
          catalogPackage.manifestPath === null
            ? null
            : PackageManifest.directoryOf(catalogPackage.manifestPath)
        const targetVersion =
          targetSource === "pinned" ? catalogPackage.version : (installed?.version ?? null)
        const targetPackagePath =
          pinnedDirectory === null
            ? (installed?.packagePath ?? null)
            : path.relative(repository.root, path.join(repository.expoRoot, pinnedDirectory))
        const targetFiles =
          pinnedDirectory === null
            ? (installed?.files ?? [])
            : filesBelow(expoFiles, pinnedDirectory)
        const targetEntrypoints =
          targetSource === "pinned" ? catalogPackage.entrypoints : (installed?.entrypoints ?? [])
        if (targetSource === "pinned" && targetFiles.length === 0) {
          return yield* failure(
            "resolve pinned Expo target files",
            targetPackagePath ?? undefined,
            `${name} has no tracked files at the pinned revision`,
          )
        }
        const expandedEntrypoints = targetEntrypoints.flatMap((entrypoint) =>
          WildcardExports.expand(entrypoint, targetFiles, targetSource),
        )

        return {
          name,
          expectedVersion,
          declaredVersion: declaredVersion ?? null,
          status,
          targetSource,
          targetVersion,
          targetPackagePath,
          targetFiles,
          targetEntrypoints,
          registryPackage: installed,
          registryMatchesPinnedRevision:
            targetSource === "pinned" &&
            installed?.gitHead !== null &&
            installed?.gitHead !== undefined
              ? installed.gitHead === repository.upstreams.expo.revision
              : null,
          expandedEntrypoints,
        } satisfies InstalledPackage
      }),
    { concurrency: 8 },
  )

  return {
    schemaVersion: 2,
    expoRevision: repository.upstreams.expo.revision,
    lockfileHash,
    packages,
  } satisfies ExpoInstallation
})

const issue = (entry: InstalledPackage): string | undefined => {
  return Match.value(entry.status).pipe(
    Match.when("valid", () => undefined),
    Match.whenOr(
      "missing",
      "not-declared",
      "version-mismatch",
      "unlocked",
      (status) =>
        `${entry.name}: ${status} (declared ${entry.declaredVersion ?? "nothing"}, expected ${entry.expectedVersion}, installed ${entry.registryPackage?.version ?? "nothing"})`,
    ),
    Match.exhaustive,
  )
}

export const issues = (installation: ExpoInstallation): ReadonlyArray<string> =>
  installation.packages.flatMap((entry) => {
    const message = issue(entry)
    return message === undefined ? [] : [message]
  })

export const blockingIssues = (installation: ExpoInstallation): ReadonlyArray<string> =>
  installation.packages
    // A catalog target may intentionally be absent from the minimal runner. Its generated
    // single-package or cohort fixture owns installation and resolution validation instead.
    .filter((entry) => entry.status !== "valid" && entry.declaredVersion !== null)
    .flatMap((entry) => {
      const message = issue(entry)
      return message === undefined ? [] : [message]
    })

export const registryDifferences = (installation: ExpoInstallation): ReadonlyArray<string> =>
  installation.packages
    .filter((entry) => entry.registryMatchesPinnedRevision === false)
    .map(
      (entry) =>
        `${entry.name}: registry commit ${entry.registryPackage?.gitHead ?? "unknown"} differs from pinned target ${installation.expoRevision}`,
    )
