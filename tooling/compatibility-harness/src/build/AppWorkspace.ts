import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import {
  BuildPipelineError,
  ProbeCatalog,
  isRecord,
  safeBuildId,
  type BuildRequest,
  type PinnedExpoToolchain,
} from "./BuildModel.ts"

export interface ExpoPackageResolution {
  readonly name: string
  readonly source: string
}

export interface DependencyResolution extends ExpoPackageResolution {
  readonly owner: "pinned-expo" | "root"
}

export interface PreparedAppWorkspace {
  readonly workspace: string
  readonly appDirectory: string
  readonly expoPackageResolutions: ReadonlyArray<ExpoPackageResolution>
  readonly dependencyResolutions: ReadonlyArray<DependencyResolution>
  readonly pinnedExpoPackages: ReadonlyArray<ExpoPackageResolution>
  readonly packageResolutionManifest: string
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

export class AppWorkspace extends Context.Service<AppWorkspace, Service>()(
  "@better-native/compatibility-harness/AppWorkspace",
) {}

const packageName = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/

const dependencyOwner = (pinned: string | undefined): "root" | "pinned-expo" =>
  Match.value(pinned).pipe(
    Match.when(undefined, () => "root" as const),
    Match.orElse(() => "pinned-expo" as const),
  )

export const workspaceName = (request: BuildRequest): string => {
  const probe = request.probeSpecifier?.replaceAll(/[^A-Za-z0-9._-]/g, "-")
  return [request.platform, request.mode, ...(probe === undefined ? [] : [probe])].join("-")
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
          if (!safeBuildId.test(request.id)) {
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
          const parsedManifest = yield* fs.readFileString(appManifestPath).pipe(
            Effect.flatMap((text) =>
              Effect.try({
                try: () => JSON.parse(text) as unknown,
                catch: (cause) => new BuildPipelineError({ phase: "workspace", request, cause }),
              }),
            ),
          )
          if (!isRecord(parsedManifest)) {
            return yield* new BuildPipelineError({
              phase: "workspace",
              request,
              cause: "compatibility app package.json must contain a JSON object",
            })
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
          for (const [name, source] of [...pinnedPackages].toSorted(([left], [right]) =>
            left.localeCompare(right),
          )) {
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
            ...pinnedExpoPackages.map(({ name, source }) => ({
              name,
              source,
              owner: "pinned-expo" as const,
              direct: declaredDependencies.has(name),
            })),
            ...dependencyResolutions
              .filter(({ owner }) => owner === "root")
              .map(({ name, source, owner }) => ({ name, source, owner, direct: true })),
          ].toSorted((left, right) => left.name.localeCompare(right.name))
          const packageResolutionManifest = path.join(workspace, "expo-package-resolutions.json")
          yield* fs.writeFileString(
            packageResolutionManifest,
            `${JSON.stringify({ schemaVersion: 1, packages: packageResolutionEntries }, null, 2)}\n`,
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
            expoPackageResolutions,
            dependencyResolutions,
            pinnedExpoPackages,
            packageResolutionManifest,
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
