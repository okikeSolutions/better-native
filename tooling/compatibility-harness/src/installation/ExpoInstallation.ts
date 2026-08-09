import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
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

/**
 * Classifies one expected package against declaration, version, and lock evidence.
 *
 * @param options - Expected, declared, installed, and lockfile package state.
 * @returns The first blocking installation status, or `valid` when all checks pass.
 */
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

const withoutDotSlash = (value: string): string => (value.startsWith("./") ? value.slice(2) : value)

// Expo Notifications publishes generated declarations from a gitignored build directory. Keep the
// fallback explicit and reviewable: materialized outputs must never silently widen every package's
// wildcard entrypoints or replace the tracked pinned source inventory.
const materializedPinnedSurfacePackages = new Set<string>(["expo-notifications"])

/**
 * Finds concrete manifest targets omitted by Git's tracked-file inventory.
 *
 * Expo workspace packages commonly gitignore generated `build` declarations while retaining
 * manifests that point at those files. The prepared pinned checkout materializes those outputs;
 * excluding them would collapse a public package to an opaque `$module` surface.
 */
export const missingManifestTargets = (
  targetFiles: ReadonlyArray<string>,
  entrypoints: InstalledPackage["targetEntrypoints"],
): ReadonlyArray<string> => {
  const tracked = new Set(targetFiles)
  return [
    ...new Set(
      entrypoints.flatMap((entrypoint) =>
        entrypoint.resolutionBranches.flatMap(({ target }) => {
          if (target === null || target.includes("*")) return []
          const normalized = withoutDotSlash(target)
          return tracked.has(normalized) ? [] : [normalized]
        }),
      ),
    ),
  ].toSorted()
}

/**
 * Inspects the package installation used to derive the Expo compatibility surface.
 *
 * @remarks
 * Pinned workspace packages use files from the source checkout. Bundled external
 * packages use Expo's normal installation, with registry metadata retained only
 * as comparison evidence.
 *
 * @param catalog - Pinned Expo package catalog.
 * @returns A versioned installation report with expanded wildcard entrypoints.
 * @throws {@link HarnessError} when package roots, manifests, or lock evidence cannot be read.
 */
export const inspect = Effect.fn("ExpoInstallation.inspect")(function* (catalog: Catalog) {
  const repository = yield* ExpoRepository
  const fs = yield* FileSystem.FileSystem
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
        const trackedTargetFiles =
          pinnedDirectory === null
            ? (installed?.files ?? [])
            : filesBelow(expoFiles, pinnedDirectory)
        const targetEntrypoints =
          targetSource === "pinned" ? catalogPackage.entrypoints : (installed?.entrypoints ?? [])
        const materializedTargetFiles =
          pinnedDirectory === null || !materializedPinnedSurfacePackages.has(name)
            ? []
            : yield* Effect.forEach(
                missingManifestTargets(trackedTargetFiles, targetEntrypoints),
                (target) =>
                  Effect.gen(function* () {
                    const packageRoot = path.join(repository.expoRoot, pinnedDirectory)
                    const absoluteTarget = path.join(packageRoot, target)
                    if (!(yield* fs.exists(absoluteTarget))) return []
                    const directory = path.dirname(target)
                    if (directory === ".") return [target]
                    const files = yield* fs.glob("**/*", {
                      root: path.join(packageRoot, directory),
                    })
                    return files.map((file) => path.join(directory, file).replaceAll("\\", "/"))
                  }),
                { concurrency: 4 },
              ).pipe(Effect.map((groups) => groups.flat()))
        const targetFiles = [
          ...new Set([...trackedTargetFiles, ...materializedTargetFiles]),
        ].toSorted()
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

/**
 * Reports every invalid package in an installation report.
 *
 * @param installation - Installation report to inspect.
 * @returns Human-readable issues for diagnostics.
 */
export const issues = (installation: ExpoInstallation): ReadonlyArray<string> =>
  installation.packages.flatMap((entry) => {
    const message = issue(entry)
    return message === undefined ? [] : [message]
  })

/**
 * Reports invalid packages declared by the current compatibility fixture.
 *
 * @remarks
 * Undeclared catalog packages are validated by generated single-package or cohort
 * fixtures, so their absence from the minimal runner is not itself blocking.
 *
 * @param installation - Installation report to inspect.
 * @returns Issues that block validation of the current fixture.
 */
export const blockingIssues = (installation: ExpoInstallation): ReadonlyArray<string> =>
  installation.packages
    // A catalog target may intentionally be absent from the minimal runner. Its generated
    // single-package or cohort fixture owns installation and resolution validation instead.
    .filter((entry) => entry.status !== "valid" && entry.declaredVersion !== null)
    .flatMap((entry) => {
      const message = issue(entry)
      return message === undefined ? [] : [message]
    })

/**
 * Reports registry packages whose source revision differs from the pinned oracle.
 *
 * @param installation - Installation report to inspect.
 * @returns Non-blocking revision diagnostics.
 */
export const registryDifferences = (installation: ExpoInstallation): ReadonlyArray<string> =>
  installation.packages
    .filter((entry) => entry.registryMatchesPinnedRevision === false)
    .map(
      (entry) =>
        `${entry.name}: registry commit ${entry.registryPackage?.gitHead ?? "unknown"} differs from pinned target ${installation.expoRevision}`,
    )
