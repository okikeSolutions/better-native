import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { isSafePathSegment } from "../Domain.ts"
import {
  BuildPipelineError,
  ProbeCatalog,
  isRecord,
  type BuildRequest,
  type PinnedExpoToolchain,
} from "./BuildModel.ts"
import {
  capabilityShell,
  scopeCapabilityManifest,
  type CapabilityShell,
} from "./CapabilityShell.ts"

/** Resolved path for a pinned Expo workspace package. */
export interface ExpoPackageResolution {
  readonly name: string
  readonly source: string
}

/** Resolved path for a declared external dependency. */
export type DependencyResolution = ExpoPackageResolution & {
  readonly owner: "pinned-expo" | "root"
}

/** Disposable app workspace and its validated package-resolution manifest. */
export interface PreparedAppWorkspace {
  readonly workspace: string
  readonly appDirectory: string
  /** Fully materialized package closure used by Metro and cached-artifact repacking. */
  readonly metroNodeModules: string
  readonly expoPackageResolutions: ReadonlyArray<ExpoPackageResolution>
  readonly dependencyResolutions: ReadonlyArray<DependencyResolution>
  readonly pinnedExpoPackages: ReadonlyArray<ExpoPackageResolution>
  readonly packageResolutionManifest: string
  readonly directRuntimeDependencyCount: number
  readonly nativeRootCount: number
  readonly metroClosureCount: number
}

interface Service {
  readonly pinNativePackages: (
    request: BuildRequest,
    workspace: PreparedAppWorkspace,
    packageNames: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<ExpoPackageResolution>, BuildPipelineError>
  readonly prepare: (
    request: BuildRequest,
    toolchain: PinnedExpoToolchain,
  ) => Effect.Effect<PreparedAppWorkspace, BuildPipelineError>
}

/** Effect context tag for isolated compatibility-app workspaces. */
export class AppWorkspace extends Context.Service<AppWorkspace, Service>()(
  "@better-native/compatibility-harness/AppWorkspace",
) {}

const packageName = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/

const dependencyOwner = (pinned: string | undefined): "root" | "pinned-expo" =>
  Match.value(pinned).pipe(
    Match.when(undefined, () => "root" as const),
    Match.orElse(() => "pinned-expo" as const),
  )

/**
 * Derives a safe deterministic workspace name from a build request.
 *
 * @param request - Build identity and mode.
 * @returns A path-safe disposable workspace name.
 */
export const workspaceName = (request: BuildRequest): string => {
  const probe = request.probeSpecifier?.replaceAll(/[^A-Za-z0-9._-]/g, "-")
  const capability = request.capabilitySource?.replaceAll(/[^A-Za-z0-9._-]/g, "-")
  return [
    request.platform,
    request.mode,
    ...(probe === undefined ? [] : [probe]),
    ...(capability === undefined ? [] : [capability.slice(-72)]),
  ].join("-")
}

const dependencyNames = (manifest: Record<string, unknown>): ReadonlyArray<string> => {
  const names = new Set<string>()
  for (const field of ["dependencies", "devDependencies"] as const) {
    const dependencies = manifest[field]
    if (dependencies === undefined) continue
    if (!isRecord(dependencies)) throw new Error(`${field} must contain a JSON object`)
    for (const name of Object.keys(dependencies)) {
      if (!packageName.test(name))
        throw new Error(`invalid dependency name: ${JSON.stringify(name)}`)
      names.add(name)
    }
  }
  return [...names].toSorted()
}

interface PackageDependency {
  readonly name: string
  readonly optional: boolean
}

const runtimeDependencyNames = (
  manifest: Record<string, unknown>,
): ReadonlyArray<PackageDependency> => {
  const dependencies = new Map<string, boolean>()
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
    const values = manifest[field]
    if (values === undefined) continue
    if (!isRecord(values)) throw new Error(`${field} must contain a JSON object`)
    for (const name of Object.keys(values)) {
      if (!packageName.test(name)) {
        throw new Error(`invalid dependency name: ${JSON.stringify(name)}`)
      }
      const optional = field !== "dependencies"
      dependencies.set(name, (dependencies.get(name) ?? true) && optional)
    }
  }
  return [...dependencies]
    .map(([name, optional]) => ({ name, optional }))
    .toSorted((left, right) => left.name.localeCompare(right.name))
}

const scopedLoaderSource = (shell: CapabilityShell): string =>
  [
    'import type { RegistryLoaders } from "../Registry.ts"',
    "",
    "export const loaders: RegistryLoaders = new Map([",
    `  [${JSON.stringify(shell.sourceId)}, () => require(${JSON.stringify(shell.module)}) as unknown],`,
    "]) as RegistryLoaders",
    "",
  ].join("\n")

const scopedEagerSource = (shell: CapabilityShell): string =>
  [
    ...(shell.eager ? [`require(${JSON.stringify(shell.module)})`, ""] : []),
    `export const eagerSourceIds = ${JSON.stringify(shell.eager ? [shell.sourceId] : [])} as const`,
    "",
  ].join("\n")

const scopedAppConfigSource = (shell: CapabilityShell): string =>
  [
    'import type { ExpoConfig } from "expo/config"',
    "",
    "const config: ExpoConfig = {",
    '  name: "Better Native Compatibility",',
    '  slug: "better-native-compatibility",',
    '  scheme: "better-native",',
    '  version: "1.0.0",',
    '  platforms: ["ios", "android", "web"],',
    '  ios: { bundleIdentifier: "dev.betternative.compatibility" },',
    '  android: { package: "dev.betternative.compatibility" },',
    '  web: { bundler: "metro", output: "static" },',
    `  plugins: ${JSON.stringify(shell.plugins)},`,
    "  experiments: { autolinkingModuleResolution: true, typedRoutes: true },",
    "  extra: {",
    '    eas: { projectId: "00000000-0000-4000-8000-000000000000" },',
    "    betterNativeMode: process.env.BETTER_NATIVE_MODE,",
    "    betterNativeBuildId: process.env.BETTER_NATIVE_BUILD_ID,",
    "  },",
    "}",
    "",
    "export default config",
    "",
  ].join("\n")

const scopedLayoutSource = (): string =>
  [
    'import { Stack } from "expo-router"',
    'import "../src/generated/EagerRegistrations"',
    'import "../src/generated/UpstreamSelection"',
    "",
    "export default function Layout() {",
    '  return <Stack screenOptions={{ headerTitle: "Better Native Compatibility" }} />',
    "}",
    "",
  ].join("\n")

/**
 * Builds the app-workspace service rooted at the repository artifacts directory.
 *
 * @param root - Better Native repository root.
 * @returns A layer providing {@link AppWorkspace}.
 */
export const layer = (
  root: string,
): Layer.Layer<AppWorkspace, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    AppWorkspace,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const pinNativePackages: Service["pinNativePackages"] = (request, workspace, packageNames) =>
        Effect.gen(function* () {
          const pinned = new Map(
            workspace.pinnedExpoPackages.map(({ name, source }) => [name, source] as const),
          )
          const selected = [...new Set(packageNames)]
            .map((name) => {
              const source = pinned.get(name)
              return source === undefined ? undefined : { name, source }
            })
            .filter((entry): entry is ExpoPackageResolution => entry !== undefined)
            .toSorted((left, right) => left.name.localeCompare(right.name))
          if (selected.length === 0) {
            return yield* new BuildPipelineError({
              phase: "workspace",
              request,
              cause: "native package discovery contained no pinned Expo packages",
            })
          }
          const overlay = path.join(workspace.workspace, "native-node-modules")
          yield* fs.makeDirectory(overlay)
          for (const { name, source } of selected) {
            const destination = path.join(overlay, ...name.split("/"))
            yield* fs.makeDirectory(path.dirname(destination), { recursive: true })
            yield* fs.symlink(source, destination)
          }
          const manifestPath = path.join(workspace.appDirectory, "package.json")
          const manifest = yield* fs.readFileString(manifestPath).pipe(
            Effect.flatMap((text) =>
              Effect.try({
                try: () => JSON.parse(text) as unknown,
                catch: (cause) => new BuildPipelineError({ phase: "workspace", request, cause }),
              }),
            ),
          )
          if (!isRecord(manifest)) {
            return yield* new BuildPipelineError({
              phase: "workspace",
              request,
              cause: "materialized app package.json must contain an object",
            })
          }
          const expo = isRecord(manifest.expo) ? manifest.expo : {}
          const autolinking = isRecord(expo.autolinking) ? expo.autolinking : {}
          yield* fs.writeFileString(
            manifestPath,
            `${JSON.stringify(
              {
                ...manifest,
                expo: {
                  ...expo,
                  autolinking: {
                    ...autolinking,
                    searchPaths: [path.relative(workspace.appDirectory, overlay)],
                  },
                },
              },
              null,
              2,
            )}\n`,
          )
          return selected
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase: "workspace", request, cause }),
          ),
        )
      const prepare: Service["prepare"] = (request, toolchain) =>
        Effect.gen(function* () {
          if (!isSafePathSegment(request.id)) {
            return yield* new BuildPipelineError({
              phase: "workspace",
              request,
              cause: "build ID is not a safe path segment",
            })
          }
          const workspacesRoot = path.join(root, ".artifacts", "workspaces")
          const workspace = path.join(workspacesRoot, workspaceName(request))
          if (yield* fs.exists(workspace)) {
            const canonicalParent = yield* fs.realPath(workspacesRoot)
            const canonicalWorkspace = yield* fs.realPath(workspace)
            const expected = path.join(canonicalParent, path.basename(workspace))
            if (canonicalWorkspace !== expected) {
              return yield* new BuildPipelineError({
                phase: "workspace",
                request,
                cause: `refusing linked compilation workspace ${workspace} -> ${canonicalWorkspace}`,
              })
            }
            yield* fs.remove(canonicalWorkspace, { recursive: true })
          }
          const appDirectory = path.join(workspace, "apps", "compatibility-suite")
          yield* fs.makeDirectory(path.dirname(appDirectory), { recursive: true })
          yield* fs.copy(path.join(root, "apps", "compatibility-suite"), appDirectory)
          const copiedNodeModules = path.join(appDirectory, "node_modules")
          if (yield* fs.exists(copiedNodeModules))
            yield* fs.remove(copiedNodeModules, { recursive: true })
          yield* fs.symlink(path.join(root, "vendor"), path.join(workspace, "vendor"))
          yield* fs.symlink(path.join(root, "packages"), path.join(workspace, "packages"))
          const appManifestPath = path.join(appDirectory, "package.json")
          const decodedManifest = yield* fs.readFileString(appManifestPath).pipe(
            Effect.flatMap((text) =>
              Effect.try({
                try: () => JSON.parse(text) as unknown,
                catch: (cause) => new BuildPipelineError({ phase: "workspace", request, cause }),
              }),
            ),
          )
          if (!isRecord(decodedManifest)) {
            return yield* new BuildPipelineError({
              phase: "workspace",
              request,
              cause: "compatibility app package.json must contain a JSON object",
            })
          }
          let parsedManifest: Record<string, unknown> = decodedManifest
          const shell = capabilityShell(request.capabilitySource)
          if (shell !== null) {
            parsedManifest = scopeCapabilityManifest(parsedManifest, shell)
            yield* fs.writeFileString(
              appManifestPath,
              `${JSON.stringify(parsedManifest, null, 2)}\n`,
            )
            yield* fs.writeFileString(
              path.join(appDirectory, "app.config.ts"),
              scopedAppConfigSource(shell),
            )
            yield* fs.writeFileString(
              path.join(appDirectory, "app", "_layout.tsx"),
              scopedLayoutSource(),
            )
            yield* fs.writeFileString(
              path.join(appDirectory, "src", "generated", "UpstreamSelection.ts"),
              'import { configureUpstreamSelection } from "../Registry.ts"\n\nconfigureUpstreamSelection([])\n',
            )
            for (const platform of ["web", "ios", "android"] as const) {
              yield* fs.writeFileString(
                path.join(appDirectory, "src", "generated", `RegistryLoaders.${platform}.ts`),
                scopedLoaderSource(shell),
              )
              yield* fs.writeFileString(
                path.join(appDirectory, "src", "generated", `EagerRegistrations.${platform}.ts`),
                scopedEagerSource(shell),
              )
            }
          }
          const packagesRoot = path.join(toolchain.root, "packages")
          const pinnedPackages = new Map<string, string>()
          const inspectPackageDirectory = (directory: string) =>
            Effect.gen(function* () {
              const manifestPath = path.join(directory, "package.json")
              const parsed = yield* fs.readFileString(manifestPath).pipe(
                Effect.flatMap((text) =>
                  Effect.try({
                    try: () => JSON.parse(text) as unknown,
                    catch: (cause) =>
                      new BuildPipelineError({ phase: "workspace", request, cause }),
                  }),
                ),
              )
              if (
                !isRecord(parsed) ||
                typeof parsed.name !== "string" ||
                !packageName.test(parsed.name)
              ) {
                return yield* new BuildPipelineError({
                  phase: "workspace",
                  request,
                  cause: `invalid pinned Expo package manifest: ${manifestPath}`,
                })
              }
              if (pinnedPackages.has(parsed.name)) {
                return yield* new BuildPipelineError({
                  phase: "workspace",
                  request,
                  cause: `duplicate pinned Expo package name: ${parsed.name}`,
                })
              }
              pinnedPackages.set(parsed.name, yield* fs.realPath(directory))
              return parsed.name
            })
          for (const entry of (yield* fs.readDirectory(packagesRoot)).toSorted()) {
            const directory = path.join(packagesRoot, entry)
            if ((yield* fs.stat(directory)).type !== "Directory") continue
            if (entry === "@expo") {
              for (const scopedEntry of (yield* fs.readDirectory(directory)).toSorted()) {
                const scopedDirectory = path.join(directory, scopedEntry)
                if (
                  (yield* fs.stat(scopedDirectory)).type === "Directory" &&
                  (yield* fs.exists(path.join(scopedDirectory, "package.json")))
                ) {
                  yield* inspectPackageDirectory(scopedDirectory)
                }
              }
            } else if (yield* fs.exists(path.join(directory, "package.json"))) {
              yield* inspectPackageDirectory(directory)
            }
          }

          const nodeModules = path.join(workspace, "node_modules")
          yield* fs.makeDirectory(nodeModules)
          const expoPackageResolutions: Array<ExpoPackageResolution> = []
          const dependencyResolutions: Array<DependencyResolution> = []
          const declaredDependencies = new Set(dependencyNames(parsedManifest))
          for (const name of declaredDependencies) {
            const pinned = pinnedPackages.get(name)
            const source = pinned ?? path.join(root, "node_modules", ...name.split("/"))
            if (!(yield* fs.exists(source))) {
              return yield* new BuildPipelineError({
                phase: "workspace",
                request,
                cause: `declared dependency is not installed: ${name}`,
              })
            }
            const destination = path.join(nodeModules, ...name.split("/"))
            yield* fs.makeDirectory(path.dirname(destination), { recursive: true })
            yield* fs.symlink(source, destination)
            dependencyResolutions.push({
              name,
              source: yield* fs.realPath(source),
              owner: dependencyOwner(pinned),
            })
            if (pinned !== undefined) {
              const resolved = yield* fs.realPath(destination)
              if (resolved !== pinned) {
                return yield* new BuildPipelineError({
                  phase: "workspace",
                  request,
                  cause: `pinned Expo package resolution drift for ${name}: ${resolved}`,
                })
              }
              expoPackageResolutions.push({ name, source: pinned })
            }
          }
          const exposedPinnedPackages = [...pinnedPackages]
            .filter(([name]) => shell === null || declaredDependencies.has(name))
            .toSorted(([left], [right]) => left.localeCompare(right))
          for (const [name, source] of exposedPinnedPackages) {
            const destination = path.join(nodeModules, ...name.split("/"))
            if (!(yield* fs.exists(destination))) {
              yield* fs.makeDirectory(path.dirname(destination), { recursive: true })
              yield* fs.symlink(source, destination)
            }
          }
          const pinnedExpoPackages = [...pinnedPackages]
            .map(([name, source]) => ({ name, source }))
            .toSorted((left, right) => left.name.localeCompare(right.name))
          const packageResolutionEntries = [
            ...exposedPinnedPackages.map(([name, source]) => ({
              name,
              source,
              owner: "pinned-expo" as const,
              direct: declaredDependencies.has(name),
            })),
            ...dependencyResolutions
              .filter(({ owner }) => owner === "root")
              .map(({ name, source, owner }) => ({ name, source, owner, direct: true })),
          ].toSorted((left, right) => left.name.localeCompare(right.name))
          const metroNodeModules = path.join(workspace, "metro-node-modules")
          yield* fs.makeDirectory(metroNodeModules)
          const canonicalToolchainRoot = yield* fs.realPath(toolchain.root)
          const canonicalRoot = yield* fs.realPath(root)
          const metroPackages = new Map<
            string,
            {
              readonly name: string
              readonly source: string
              readonly owner: "pinned-expo" | "root"
              readonly direct: boolean
            }
          >()
          const queue = packageResolutionEntries.map((entry) => ({ ...entry, optional: false }))
          const resolveDependency = (
            name: string,
            owner: "pinned-expo" | "root",
            parentSource: string,
          ) =>
            Effect.gen(function* () {
              const pinned = pinnedPackages.get(name)
              if (pinned !== undefined) {
                return { name, source: pinned, owner: "pinned-expo" as const }
              }
              const boundary = owner === "pinned-expo" ? canonicalToolchainRoot : canonicalRoot
              const ancestry: Array<string> = []
              let current = parentSource
              while (current === boundary || current.startsWith(`${boundary}${path.sep}`)) {
                ancestry.push(path.join(current, "node_modules", ...name.split("/")))
                const parent = path.dirname(current)
                if (parent === current) break
                current = parent
              }
              const preferred = [
                ...ancestry,
                ...(owner === "pinned-expo"
                  ? [
                      path.join(toolchain.nodeModules, ...name.split("/")),
                      path.join(root, "node_modules", ...name.split("/")),
                    ]
                  : [
                      path.join(root, "node_modules", ...name.split("/")),
                      path.join(toolchain.nodeModules, ...name.split("/")),
                    ]),
              ]
              for (const candidate of preferred) {
                if (yield* fs.exists(candidate)) {
                  const canonical = yield* fs.realPath(candidate)
                  return {
                    name,
                    source: canonical,
                    owner: canonical.startsWith(`${canonicalToolchainRoot}${path.sep}`)
                      ? ("pinned-expo" as const)
                      : ("root" as const),
                  }
                }
              }
              return null
            })
          while (queue.length > 0) {
            const entry = queue.shift()!
            if (metroPackages.has(entry.name)) continue
            const resolved = yield* resolveDependency(entry.name, entry.owner, entry.source)
            if (resolved === null) {
              if (entry.optional) continue
              return yield* new BuildPipelineError({
                phase: "workspace",
                request,
                cause: `Metro dependency is not installed: ${entry.name}`,
              })
            }
            const selected = { ...resolved, direct: entry.direct }
            metroPackages.set(entry.name, selected)
            const destination = path.join(metroNodeModules, ...entry.name.split("/"))
            yield* fs.makeDirectory(path.dirname(destination), { recursive: true })
            yield* fs.symlink(selected.source, destination)
            const dependencyManifest = path.join(selected.source, "package.json")
            if (!(yield* fs.exists(dependencyManifest))) {
              return yield* new BuildPipelineError({
                phase: "workspace",
                request,
                cause: `Metro dependency has no package.json: ${entry.name}`,
              })
            }
            const dependencyPackage = yield* fs.readFileString(dependencyManifest).pipe(
              Effect.flatMap((text) =>
                Effect.try({
                  try: () => JSON.parse(text) as unknown,
                  catch: (cause) => new BuildPipelineError({ phase: "workspace", request, cause }),
                }),
              ),
            )
            if (!isRecord(dependencyPackage)) {
              return yield* new BuildPipelineError({
                phase: "workspace",
                request,
                cause: `Metro dependency package.json must contain an object: ${entry.name}`,
              })
            }
            for (const dependency of runtimeDependencyNames(dependencyPackage)) {
              queue.push({
                name: dependency.name,
                owner: selected.owner,
                direct: false,
                optional: dependency.optional,
                source: selected.source,
              })
            }
          }
          const packageResolutionManifest = path.join(workspace, "expo-package-resolutions.json")
          yield* fs.writeFileString(
            packageResolutionManifest,
            `${JSON.stringify(
              {
                schemaVersion: 2,
                packages: packageResolutionEntries,
                metroPackages: [...metroPackages.values()].toSorted((left, right) =>
                  left.name.localeCompare(right.name),
                ),
              },
              null,
              2,
            )}\n`,
          )
          if (request.probeSpecifier !== undefined) {
            const catalogPath = path.join(
              root,
              "apps",
              "compatibility-suite",
              "src",
              "generated",
              "SurfaceProbeCatalog.json",
            )
            const catalog = yield* fs.readFileString(catalogPath).pipe(
              Effect.flatMap((text) =>
                Effect.try({
                  try: () => JSON.parse(text) as unknown,
                  catch: (cause) => new BuildPipelineError({ phase: "workspace", request, cause }),
                }),
              ),
              Effect.flatMap(Schema.decodeUnknownEffect(ProbeCatalog)),
            )
            const selected = catalog.probes.find(
              ({ specifier }) => specifier === request.probeSpecifier,
            )
            if (
              selected === undefined ||
              (selected.platforms.length > 0 && !selected.platforms.includes(request.platform))
            ) {
              return yield* new BuildPipelineError({
                phase: "workspace",
                request,
                cause: "probe specifier is not in the generated catalog for this platform",
              })
            }
            const source = [
              'import type { SurfaceProbes } from "../SurfaceProbes.ts"',
              "",
              "export const surfaceProbes: SurfaceProbes = new Map([",
              `  [${JSON.stringify(request.probeSpecifier)}, () => require(${JSON.stringify(request.probeSpecifier)}) as unknown],`,
              "])",
              "",
            ].join("\n")
            yield* fs.writeFileString(
              path.join(appDirectory, "src", "generated", `SurfaceProbes.${request.platform}.ts`),
              source,
            )
          }
          return {
            workspace,
            appDirectory,
            metroNodeModules,
            expoPackageResolutions,
            dependencyResolutions,
            pinnedExpoPackages,
            packageResolutionManifest,
            directRuntimeDependencyCount: Object.keys(
              isRecord(parsedManifest.dependencies) ? parsedManifest.dependencies : {},
            ).length,
            nativeRootCount: packageResolutionEntries.length,
            metroClosureCount: metroPackages.size,
          }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase: "workspace", request, cause }),
          ),
        )
      return AppWorkspace.of({ pinNativePackages, prepare })
    }),
  )
