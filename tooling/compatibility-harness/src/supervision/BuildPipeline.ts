import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import {
  BuildRecord,
  BuildId,
  ContentHash,
  ProcessObservation as ProcessObservationSchema,
  type BuildRecord as BuildRecordType,
  type Mode,
  type ProcessObservation,
} from "../Domain.ts"
import { EvidenceStore } from "./EvidenceStore.ts"
import { ProcessSupervisor, type ProcessResult, type ProcessSpec } from "./ProcessSupervisor.ts"

export interface BuildRequest {
  readonly id: string
  readonly mode: Mode
  readonly platform: "web" | "ios" | "android"
  readonly expoRevision: string
  readonly candidateRevision: string | null
  readonly timeoutMillis: number
  readonly probeSpecifier?: string
}

export interface BuildOutput {
  readonly record: BuildRecordType
  readonly workspace: string
  readonly appDirectory: string
  readonly output: string
  readonly expoCli: string
  readonly observations: ReadonlyArray<ProcessObservation>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export interface BuildImportRequest {
  readonly recordPath: string
  readonly binaryPath: string
  readonly platform: "ios" | "android"
}

export class BuildPipelineError extends Data.TaggedError("BuildPipelineError")<{
  readonly phase: "upstream" | "workspace" | "prebuild" | "build" | "evidence"
  readonly request: BuildRequest
  readonly cause: unknown
}> {}

export class BuildImportError extends Data.TaggedError("BuildImportError")<{
  readonly request: BuildImportRequest
  readonly cause: unknown
}> {}

export interface Service {
  readonly build: (request: BuildRequest) => Effect.Effect<BuildOutput, BuildPipelineError>
  readonly load: (request: BuildImportRequest) => Effect.Effect<BuildOutput, BuildImportError>
}

export class BuildPipeline extends Context.Service<BuildPipeline, Service>()(
  "@better-native/compatibility-harness/BuildPipeline",
) {}

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const gitRevision = /^[0-9a-f]{40}$/
/** Packages whose source app plugins are evaluated by the compatibility app. */
export const pinnedPluginPackages = [
  "expo-router",
  "expo-video",
  "expo-background-fetch",
  "expo-background-task",
  "expo-font",
  "expo-notifications",
  "expo-location",
  "expo-tracking-transparency",
  "expo-web-browser",
  "expo-build-properties",
] as const
const ProbeCatalog = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  probes: Schema.Array(
    Schema.Struct({ specifier: Schema.String, platforms: Schema.Array(Schema.String) }),
  ),
})

export const layer = (
  root: string,
): Layer.Layer<
  BuildPipeline,
  never,
  ProcessSupervisor | EvidenceStore | FileSystem.FileSystem | Path.Path | Crypto.Crypto
> =>
  Layer.effect(
    BuildPipeline,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const crypto = yield* Crypto.Crypto
      const processes = yield* ProcessSupervisor
      const evidence = yield* EvidenceStore
      const digest = (bytes: Uint8Array) =>
        crypto
          .digest("SHA-256", bytes)
          .pipe(Effect.map((value) => ContentHash.make(Encoding.encodeHex(value))))
      const hashOutput = (directory: string): Effect.Effect<ContentHash, unknown> =>
        Effect.gen(function* () {
          const canonicalParent = yield* fs.realPath(path.dirname(directory))
          const expectedRoot = path.join(canonicalParent, path.basename(directory))
          const canonicalRoot = yield* fs.realPath(directory)
          if (canonicalRoot !== expectedRoot) {
            return yield* Effect.fail(
              `refusing symbolic-link build product ${directory} -> ${canonicalRoot}`,
            )
          }
          const rootInfo = yield* fs.stat(canonicalRoot)
          if (rootInfo.type === "File") return yield* digest(yield* fs.readFile(canonicalRoot))
          if (rootInfo.type !== "Directory") {
            return yield* Effect.fail(`unsupported build product type ${rootInfo.type}`)
          }
          const entries: Array<string> = []
          const visit = (current: string): Effect.Effect<void, unknown> =>
            Effect.gen(function* () {
              for (const name of (yield* fs.readDirectory(current)).toSorted()) {
                const absolute = path.join(current, name)
                const canonical = yield* fs.realPath(absolute)
                if (canonical !== absolute) {
                  return yield* Effect.fail(
                    `refusing symbolic link in build product ${absolute} -> ${canonical}`,
                  )
                }
                const info = yield* fs.stat(canonical)
                if (info.type === "Directory") {
                  yield* visit(canonical)
                } else if (info.type === "File") {
                  const content = yield* fs.readFile(canonical)
                  const fileHash = yield* digest(content)
                  entries.push(`${path.relative(canonicalRoot, canonical)}\0${fileHash}`)
                } else {
                  return yield* Effect.fail(
                    `unsupported build product entry ${absolute} (${info.type})`,
                  )
                }
              }
              return undefined
            })
          yield* visit(canonicalRoot)
          return yield* digest(new TextEncoder().encode(entries.join("\n")))
        })
      const persistObservations = (
        request: BuildRequest,
        name: string,
        observations: ReadonlyArray<ProcessObservation>,
      ) =>
        evidence.writeBytes(
          "builds",
          request.id,
          name,
          "application/x-ndjson",
          new TextEncoder().encode(
            observations.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
          ),
        )
      const execute = (
        request: BuildRequest,
        phase: BuildPipelineError["phase"],
        name: string,
        spec: ProcessSpec,
      ) =>
        Effect.gen(function* () {
          const result = yield* processes.run(spec).pipe(
            Effect.catch((cause) =>
              persistObservations(request, name, cause.observations).pipe(
                Effect.mapError(
                  (evidenceCause) =>
                    new BuildPipelineError({ phase: "evidence", request, cause: evidenceCause }),
                ),
                Effect.andThen(Effect.fail(new BuildPipelineError({ phase, request, cause }))),
              ),
            ),
          )
          const artifact = yield* persistObservations(request, name, result.observations).pipe(
            Effect.mapError(
              (cause) => new BuildPipelineError({ phase: "evidence", request, cause }),
            ),
          )
          if (result.exitCode !== 0) {
            const detail = result.observations
              .slice(-30)
              .map(({ text }) => text)
              .join("\n")
            return yield* new BuildPipelineError({
              phase,
              request,
              cause: `command exited ${result.exitCode}\n${detail}`,
            })
          }
          return { result, artifact }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase, request, cause }),
          ),
        )
      const prepare = (request: BuildRequest, pinnedNodeModules: string) =>
        Effect.gen(function* () {
          if (!safeId.test(request.id)) {
            return yield* new BuildPipelineError({
              phase: "workspace",
              request,
              cause: "build ID is not a safe path segment",
            })
          }
          const workspace = path.join(root, ".artifacts", "workspaces", request.id)
          if (yield* fs.exists(workspace)) {
            return yield* new BuildPipelineError({
              phase: "workspace",
              request,
              cause: "isolated CNG workspace already exists",
            })
          }
          const appDirectory = path.join(workspace, "apps", "compatibility-suite")
          yield* fs.makeDirectory(path.dirname(appDirectory), { recursive: true })
          yield* fs.copy(path.join(root, "apps", "compatibility-suite"), appDirectory)
          yield* fs.symlink(path.join(root, "node_modules"), path.join(workspace, "node_modules"))
          yield* fs.symlink(path.join(root, "vendor"), path.join(workspace, "vendor"))
          yield* fs.symlink(path.join(root, "packages"), path.join(workspace, "packages"))
          const appManifestPath = path.join(appDirectory, "package.json")
          const parsedManifest = yield* fs.readFileString(appManifestPath).pipe(
            Effect.flatMap((text) =>
              Effect.try({
                try: () => JSON.parse(text) as unknown,
                catch: (cause) => cause,
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
          const appManifest = parsedManifest
          const expo = isRecord(appManifest.expo) ? appManifest.expo : {}
          const autolinking = isRecord(expo.autolinking) ? expo.autolinking : {}
          appManifest.expo = {
            ...expo,
            autolinking: {
              ...autolinking,
              searchPaths: [pinnedNodeModules, path.join(root, "node_modules")],
            },
          }
          yield* fs.writeFileString(appManifestPath, `${JSON.stringify(appManifest, null, 2)}\n`)
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
                Effect.try({ try: () => JSON.parse(text) as unknown, catch: (cause) => cause }),
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
          return { workspace, appDirectory }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase: "workspace", request, cause }),
          ),
        )
      const preparePinnedUpstream = (request: BuildRequest) =>
        Effect.gen(function* () {
          if (!safeId.test(request.id)) {
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: "build ID is not a safe path segment",
            })
          }
          if (!gitRevision.test(request.expoRevision)) {
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: "Expo revision must be a full 40-character lowercase Git revision",
            })
          }
          const upstreamParent = path.join(root, ".artifacts", "upstreams")
          yield* fs.makeDirectory(upstreamParent, { recursive: true })
          const canonicalParent = yield* fs.realPath(upstreamParent)
          const canonicalRoot = yield* fs.realPath(root)
          const expectedParent = path.join(canonicalRoot, ".artifacts", "upstreams")
          if (canonicalParent !== expectedParent) {
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: `refusing symbolic-link upstream cache root ${upstreamParent} -> ${canonicalParent}`,
            })
          }
          const upstream = path.join(canonicalParent, `expo-${request.expoRevision}-${request.id}`)
          if (yield* fs.exists(upstream)) {
            const existingCanonicalUpstream = yield* fs.realPath(upstream)
            if (existingCanonicalUpstream !== upstream) {
              return yield* new BuildPipelineError({
                phase: "upstream",
                request,
                cause: `refusing symbolic-link pinned Expo workspace ${upstream} -> ${existingCanonicalUpstream}`,
              })
            }
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: `refusing to reuse executable Expo materialization ${upstream}`,
            })
          }
          yield* execute(request, "upstream", "upstream-worktree.ndjson", {
            command: "git",
            args: [
              "-C",
              path.join(root, "vendor", "expo"),
              "worktree",
              "add",
              "--detach",
              upstream,
              request.expoRevision,
            ],
            cwd: root,
            timeoutMillis: request.timeoutMillis,
          })
          yield* execute(request, "upstream", "upstream-install.ndjson", {
            command: "corepack",
            args: ["pnpm@10.33.0", "install", "--frozen-lockfile"],
            env: { COREPACK_ENABLE_PROJECT_SPEC: "0" },
            cwd: upstream,
            timeoutMillis: request.timeoutMillis,
          })
          // Every build gets a fresh worktree, install, and build. Executable
          // ignored outputs are never trusted across invocations.
          yield* execute(request, "upstream", "upstream-build.ndjson", {
            command: "corepack",
            args: [
              "pnpm@10.33.0",
              "turbo",
              "build",
              "--filter",
              "test-suite...",
              ...pinnedPluginPackages.flatMap((packageName) => ["--filter", `${packageName}...`]),
            ],
            env: { COREPACK_ENABLE_PROJECT_SPEC: "0" },
            cwd: upstream,
            timeoutMillis: request.timeoutMillis,
          })
          const canonicalUpstream = yield* fs.realPath(upstream)
          if (canonicalUpstream !== upstream) {
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: `refusing symbolic-link pinned Expo workspace ${upstream} -> ${canonicalUpstream}`,
            })
          }
          const revisionResult = yield* processes.run({
            command: "git",
            args: ["-C", canonicalUpstream, "rev-parse", "HEAD"],
            cwd: root,
            timeoutMillis: Math.min(request.timeoutMillis, 30_000),
          })
          const actualRevision = revisionResult.observations
            .filter(({ stream }) => stream === "stdout")
            .map(({ text }) => text)
            .join("")
            .trim()
          if (revisionResult.exitCode !== 0 || actualRevision !== request.expoRevision) {
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: `pinned Expo workspace HEAD ${actualRevision || "<unavailable>"} differs from ${request.expoRevision}`,
            })
          }
          const cleanResult = yield* processes.run({
            command: "git",
            args: ["-C", canonicalUpstream, "diff-index", "--quiet", "HEAD", "--"],
            cwd: root,
            timeoutMillis: Math.min(request.timeoutMillis, 30_000),
          })
          if (cleanResult.exitCode !== 0) {
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: "pinned Expo workspace contains modified tracked files",
            })
          }
          const required = [
            [path.join(upstream, "node_modules"), "Directory"],
            [path.join(upstream, "node_modules", ".modules.yaml"), "File"],
            [path.join(upstream, "packages", "expo", "build", "Expo.js"), "File"],
            [path.join(upstream, "packages", "expo", "build", "Expo.d.ts"), "File"],
          ] as const
          for (const [target, type] of required) {
            const canonical = yield* fs
              .realPath(target)
              .pipe(Effect.mapError(() => `required pinned Expo artifact is missing: ${target}`))
            if (canonical !== target || (yield* fs.stat(canonical)).type !== type) {
              return yield* new BuildPipelineError({
                phase: "upstream",
                request,
                cause: `required pinned Expo artifact is not a real ${type.toLowerCase()}: ${target}`,
              })
            }
          }
          for (const packageName of pinnedPluginPackages) {
            const plugin = path.join(upstream, "packages", packageName, "app.plugin.js")
            const source = yield* fs
              .readFileString(plugin)
              .pipe(Effect.mapError(() => `required pinned Expo plugin is missing: ${plugin}`))
            const target = source.match(/require\(['"](.+?)['"]\)/)?.[1]
            if (target === undefined) {
              return yield* new BuildPipelineError({
                phase: "upstream",
                request,
                cause: `pinned Expo plugin has no statically verifiable implementation: ${plugin}`,
              })
            }
            const implementation = path.resolve(path.dirname(plugin), target)
            const implementationFile = implementation.endsWith(".js")
              ? implementation
              : `${implementation}.js`
            if (!(yield* fs.exists(implementationFile))) {
              return yield* new BuildPipelineError({
                phase: "upstream",
                request,
                cause: `pinned Expo plugin implementation is missing: ${implementationFile}`,
              })
            }
          }
          return { root: upstream, nodeModules: path.join(upstream, "node_modules") }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase: "upstream", request, cause }),
          ),
        )
      const build: Service["build"] = (request) =>
        Effect.gen(function* () {
          const pinnedUpstream = yield* preparePinnedUpstream(request)
          const { appDirectory, workspace } = yield* prepare(request, pinnedUpstream.nodeModules)
          const commonEnv = {
            BETTER_NATIVE_MODE: request.mode,
            BETTER_NATIVE_BUILD_ID: request.id,
            BETTER_NATIVE_RUN_ID: `build-${request.id}`,
            CI: "1",
            BETTER_NATIVE_UPSTREAM_NODE_MODULES: pinnedUpstream.nodeModules,
            BETTER_NATIVE_PINNED_EXPO_ROOT: pinnedUpstream.root,
          }
          const expoCli = path.join(pinnedUpstream.root, "packages", "expo", "bin", "cli")
          const results: Array<{
            readonly result: ProcessResult
            readonly artifact: BuildRecordType["artifacts"][number]
          }> = []
          results.push(
            yield* execute(request, "prebuild", "config-evaluation.ndjson", {
              command: "node",
              args: [expoCli, "config", "--type", "prebuild", "--json"],
              cwd: appDirectory,
              env: commonEnv,
              timeoutMillis: Math.min(request.timeoutMillis, 120_000),
            }),
          )
          let output: string
          if (request.platform === "web") {
            output = path.join(workspace, "dist")
            results.push(
              yield* execute(request, "build", "process-1.ndjson", {
                command: "node",
                args: [
                  expoCli,
                  "export",
                  "--platform",
                  "web",
                  "--no-minify",
                  "--output-dir",
                  output,
                  "--clear",
                ],
                cwd: appDirectory,
                env: commonEnv,
                timeoutMillis: request.timeoutMillis,
              }),
            )
          } else {
            results.push(
              yield* execute(request, "prebuild", "process-1.ndjson", {
                command: "node",
                args: [
                  expoCli,
                  "prebuild",
                  "--clean",
                  "--no-install",
                  "--platform",
                  request.platform,
                ],
                cwd: appDirectory,
                env: commonEnv,
                timeoutMillis: request.timeoutMillis,
              }),
            )
            if (request.platform === "android") {
              output = path.join(
                appDirectory,
                "android",
                "app",
                "build",
                "outputs",
                "apk",
                "release",
                "app-release.apk",
              )
              results.push(
                yield* execute(request, "build", "process-2.ndjson", {
                  command: path.join(appDirectory, "android", "gradlew"),
                  args: [":app:assembleRelease", "--no-daemon", "--stacktrace"],
                  cwd: path.join(appDirectory, "android"),
                  env: commonEnv,
                  timeoutMillis: request.timeoutMillis,
                }),
              )
            } else {
              const iosDirectory = path.join(appDirectory, "ios")
              const derived = path.join(workspace, "derived-data")
              results.push(
                yield* execute(request, "build", "process-2.ndjson", {
                  command: "pod",
                  args: ["install"],
                  cwd: iosDirectory,
                  env: commonEnv,
                  timeoutMillis: request.timeoutMillis,
                }),
              )
              results.push(
                yield* execute(request, "build", "process-3.ndjson", {
                  command: "xcodebuild",
                  args: [
                    "-workspace",
                    path.join(iosDirectory, "BetterNativeCompatibility.xcworkspace"),
                    "-scheme",
                    "BetterNativeCompatibility",
                    "-configuration",
                    "Release",
                    "-sdk",
                    "iphonesimulator",
                    "-derivedDataPath",
                    derived,
                    "build",
                  ],
                  cwd: iosDirectory,
                  env: commonEnv,
                  timeoutMillis: request.timeoutMillis,
                }),
              )
              output = path.join(
                derived,
                "Build",
                "Products",
                "Release-iphonesimulator",
                "BetterNativeCompatibility.app",
              )
            }
          }
          const artifacts = results.map(({ artifact }) => artifact)
          const bundleHash = yield* hashOutput(output).pipe(
            Effect.mapError((cause) => new BuildPipelineError({ phase: "build", request, cause })),
          )
          const configurationHash = yield* digest(
            new TextEncoder().encode(
              JSON.stringify({
                mode: request.mode,
                platform: request.platform,
                expoRevision: request.expoRevision,
                candidateRevision: request.candidateRevision,
                probeSpecifier: request.probeSpecifier ?? null,
              }),
            ),
          ).pipe(
            Effect.mapError(
              (cause) => new BuildPipelineError({ phase: "evidence", request, cause }),
            ),
          )
          const record: BuildRecordType = {
            schemaVersion: 1,
            id: BuildId.make(request.id),
            mode: request.mode,
            platform: request.platform,
            expoRevision: request.expoRevision,
            candidateRevision: request.candidateRevision,
            configurationHash,
            bundleHash,
            nativeBinaryHash: request.platform === "web" ? null : bundleHash,
            artifacts,
          }
          yield* evidence
            .writeJson("builds", request.id, "record.json", BuildRecord, record)
            .pipe(
              Effect.mapError(
                (cause) => new BuildPipelineError({ phase: "evidence", request, cause }),
              ),
            )
          return {
            record,
            workspace,
            appDirectory,
            output,
            expoCli,
            observations: results.flatMap(({ result }) => result.observations),
          }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase: "build", request, cause }),
          ),
        )
      const load: Service["load"] = (request) =>
        Effect.gen(function* () {
          const encoded = yield* fs.readFileString(request.recordPath)
          const parsed = yield* Effect.try({
            try: () => JSON.parse(encoded) as unknown,
            catch: (cause) => cause,
          })
          const record = yield* Schema.decodeUnknownEffect(BuildRecord)(parsed)
          if (record.platform !== request.platform) {
            return yield* new BuildImportError({
              request,
              cause: `build record platform ${record.platform} does not match ${request.platform}`,
            })
          }
          if (!(yield* fs.exists(request.binaryPath))) {
            return yield* new BuildImportError({ request, cause: "native binary does not exist" })
          }
          const binaryHash = yield* hashOutput(request.binaryPath)
          if (record.nativeBinaryHash === null || binaryHash !== record.nativeBinaryHash) {
            return yield* new BuildImportError({
              request,
              cause: `native binary hash ${binaryHash} does not match ${record.nativeBinaryHash}`,
            })
          }
          const observations = (yield* Effect.forEach(
            record.artifacts.filter(({ mediaType }) => mediaType === "application/x-ndjson"),
            (artifact) =>
              Effect.gen(function* () {
                const artifactPath = path.join(
                  path.dirname(request.recordPath),
                  path.basename(artifact.path),
                )
                if (!(yield* fs.exists(artifactPath))) {
                  return yield* new BuildImportError({
                    request,
                    cause: `build observation artifact is missing: ${artifactPath}`,
                  })
                }
                const artifactHash = yield* hashOutput(artifactPath)
                if (artifactHash !== artifact.hash) {
                  return yield* new BuildImportError({
                    request,
                    cause: `build observation hash ${artifactHash} does not match ${artifact.hash}`,
                  })
                }
                const text = yield* fs.readFileString(artifactPath)
                return yield* Effect.forEach(
                  text.split("\n").filter((line) => line.length > 0),
                  (line) =>
                    Effect.try({
                      try: () => JSON.parse(line) as unknown,
                      catch: (cause) => cause,
                    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ProcessObservationSchema))),
                )
              }),
          )).flat()
          return {
            record,
            workspace: path.dirname(request.binaryPath),
            appDirectory: root,
            output: request.binaryPath,
            expoCli: path.join(root, "node_modules", "expo", "bin", "cli"),
            observations,
          }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildImportError ? cause : new BuildImportError({ request, cause }),
          ),
        )
      return BuildPipeline.of({ build, load })
    }),
  )
