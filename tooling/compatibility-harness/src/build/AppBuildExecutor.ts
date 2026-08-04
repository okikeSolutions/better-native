import { createFingerprintAsync } from "@expo/fingerprint"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import { BuildId, BuildRecord, type BuildRecord as BuildRecordType } from "../Domain.ts"
import { EvidenceStore } from "../evidence/EvidenceStore.ts"
import { HarnessConfig } from "../HarnessConfig.ts"
import { AppWorkspace } from "./AppWorkspace.ts"
import { BuildCommand, type BuildCommandResult } from "./BuildCommand.ts"
import {
  BuildPipelineError,
  type BuildOutput,
  type BuildRequest,
  type PinnedExpoToolchain,
} from "./BuildModel.ts"
import { BuildProducts } from "./BuildProducts.ts"
import { NativeArtifactCache } from "./NativeArtifactCache.ts"
import { discoverNativeExpoPackages, validateNativeResolution } from "./NativeResolution.ts"

interface Service {
  readonly execute: (
    request: BuildRequest,
    toolchain: PinnedExpoToolchain,
  ) => Effect.Effect<BuildOutput, BuildPipelineError>
}

const nativeAutolinkingPlatform = (platform: "ios" | "android") =>
  Match.value(platform).pipe(
    Match.when("ios", () => "apple" as const),
    Match.when("android", () => "android" as const),
    Match.exhaustive,
  )

const nativeFingerprintPlatform = (platform: BuildRequest["platform"]): Array<"ios" | "android"> =>
  Match.value(platform).pipe(
    Match.when("web", () => [] as Array<"ios" | "android">),
    Match.when("ios", () => ["ios"] as Array<"ios" | "android">),
    Match.when("android", () => ["android"] as Array<"ios" | "android">),
    Match.exhaustive,
  )

const nativeToolchainCommand = (platform: "ios" | "android", cwd: string, timeoutMillis: number) =>
  Match.value(platform).pipe(
    Match.when("ios", () => ({ command: "xcodebuild", args: ["-version"], cwd, timeoutMillis })),
    Match.when("android", () => ({ command: "java", args: ["-version"], cwd, timeoutMillis })),
    Match.exhaustive,
  )

const initialBuildDecision = (platform: BuildRequest["platform"]) =>
  Match.value(platform).pipe(
    Match.when("web", () => "bundle" as const),
    Match.whenOr("ios", "android", () => "full-build" as const),
    Match.exhaustive,
  )

const cacheHitStatus = (hit: boolean) =>
  Match.value(hit).pipe(
    Match.when(true, () => "hit" as const),
    Match.when(false, () => "miss" as const),
    Match.exhaustive,
  )

export class AppBuildExecutor extends Context.Service<AppBuildExecutor, Service>()(
  "@better-native/compatibility-harness/AppBuildExecutor",
) {}

export const layer = (
  root: string,
): Layer.Layer<
  AppBuildExecutor,
  never,
  | AppWorkspace
  | BuildCommand
  | BuildProducts
  | EvidenceStore
  | FileSystem.FileSystem
  | Path.Path
  | NativeArtifactCache
  | HarnessConfig
> =>
  Layer.effect(
    AppBuildExecutor,
    Effect.gen(function* () {
      const path = yield* Path.Path
      const fs = yield* FileSystem.FileSystem
      const evidence = yield* EvidenceStore
      const workspace = yield* AppWorkspace
      const commands = yield* BuildCommand
      const products = yield* BuildProducts
      const nativeCache = yield* NativeArtifactCache
      const config = yield* HarnessConfig
      const execute: Service["execute"] = (request, pinnedUpstream) =>
        Effect.gen(function* () {
          const prepared = yield* workspace.prepare(request, pinnedUpstream)
          const { appDirectory, workspace: workspaceRoot } = prepared
          const commonEnv = {
            BETTER_NATIVE_MODE: request.mode,
            BETTER_NATIVE_BUILD_ID: request.id,
            BETTER_NATIVE_RUN_ID: `build-${request.id}`,
            CI: "1",
            BETTER_NATIVE_UPSTREAM_NODE_MODULES: path.join(workspaceRoot, "node_modules"),
            BETTER_NATIVE_PINNED_EXPO_ROOT: pinnedUpstream.root,
            CCACHE_BASEDIR: workspaceRoot,
          }
          const expoCli = path.join(pinnedUpstream.root, "packages", "expo", "bin", "cli")
          const results: Array<BuildCommandResult> = [
            yield* commands.run(request, "prebuild", "package-resolution.ndjson", {
              command: "node",
              args: [
                path.join(
                  root,
                  "tooling",
                  "compatibility-harness",
                  "scripts",
                  "verify-expo-package-resolution.mjs",
                ),
                prepared.packageResolutionManifest,
                appDirectory,
              ],
              cwd: appDirectory,
              env: commonEnv,
              timeoutMillis: Math.min(request.timeoutMillis, 30_000),
            }),
          ]
          if (request.platform !== "web") {
            const autolinkingCli = path.join(
              pinnedUpstream.root,
              "packages",
              "expo-modules-autolinking",
              "bin",
              "expo-modules-autolinking.js",
            )
            const discovery = yield* commands.run(
              request,
              "prebuild",
              "expo-autolinking-discovery.ndjson",
              {
                command: "node",
                args: [
                  autolinkingCli,
                  "resolve",
                  "--platform",
                  nativeAutolinkingPlatform(request.platform),
                  "--json",
                ],
                cwd: appDirectory,
                env: commonEnv,
                timeoutMillis: Math.min(request.timeoutMillis, 120_000),
              },
            )
            const nativePackageNames = yield* discoverNativeExpoPackages(
              discovery.result.observations,
            ).pipe(
              Effect.mapError(
                (cause) => new BuildPipelineError({ phase: "prebuild", request, cause }),
              ),
            )
            yield* workspace.pinNativePackages(request, prepared, nativePackageNames)
            const expoModules = yield* commands.run(
              request,
              "prebuild",
              "expo-autolinking-resolution.ndjson",
              {
                command: "node",
                args: [
                  autolinkingCli,
                  "resolve",
                  "--platform",
                  nativeAutolinkingPlatform(request.platform),
                  "--json",
                ],
                cwd: appDirectory,
                env: commonEnv,
                timeoutMillis: Math.min(request.timeoutMillis, 120_000),
              },
            )
            const reactNativeModules = yield* commands.run(
              request,
              "prebuild",
              "react-native-autolinking-resolution.ndjson",
              {
                command: "node",
                args: [
                  autolinkingCli,
                  "react-native-config",
                  "--platform",
                  request.platform,
                  "--json",
                ],
                cwd: appDirectory,
                env: commonEnv,
                timeoutMillis: Math.min(request.timeoutMillis, 120_000),
              },
            )
            results.push(discovery, expoModules, reactNativeModules)
            yield* validateNativeResolution({
              workspace: prepared,
              expoModules: expoModules.result.observations,
              reactNativeModules: reactNativeModules.result.observations,
            }).pipe(
              Effect.mapError(
                (cause) => new BuildPipelineError({ phase: "prebuild", request, cause }),
              ),
            )
          }
          results.push(
            yield* commands.run(request, "prebuild", "config-evaluation.ndjson", {
              command: "node",
              args: [expoCli, "config", "--type", "prebuild", "--json"],
              cwd: appDirectory,
              env: commonEnv,
              timeoutMillis: Math.min(request.timeoutMillis, 120_000),
            }),
          )
          let output: string
          let nativeFingerprint: string | null = null
          let toolchainFingerprint: BuildRecordType["toolchainFingerprint"] = null
          let buildDecision: BuildRecordType["buildDecision"] = initialBuildDecision(
            request.platform,
          )
          let nativeCacheEvidence: BuildRecordType["nativeArtifact"] = null
          let nativeCacheStatus: BuildRecordType["performance"]["caches"][number] | null = null
          let podsCacheStatus: BuildRecordType["performance"]["caches"][number] | null = null
          const nativeCacheArtifacts: Array<BuildRecordType["artifacts"][number]> = []
          const nativeCachePhases: Array<BuildRecordType["performance"]["phases"][number]> = []
          if (request.platform === "web") {
            output = path.join(workspaceRoot, "dist")
            results.push(
              yield* commands.run(request, "build", "process-1.ndjson", {
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
              yield* commands.run(request, "prebuild", "process-1.ndjson", {
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
            const fingerprint = yield* Effect.tryPromise({
              try: () =>
                createFingerprintAsync(appDirectory, {
                  platforms: nativeFingerprintPlatform(request.platform),
                  silent: true,
                }),
              catch: (cause) => new BuildPipelineError({ phase: "prebuild", request, cause }),
            })
            nativeFingerprint = fingerprint.hash
            nativeCacheArtifacts.push(
              yield* commands.persistObservations(request, "native-fingerprint.ndjson", [
                {
                  sequence: 0,
                  timestampMillis: 0,
                  stream: "stdout",
                  text: JSON.stringify(fingerprint),
                },
              ]),
            )
            const toolchain = yield* commands.run(
              request,
              "prebuild",
              "native-toolchain.ndjson",
              nativeToolchainCommand(
                request.platform,
                appDirectory,
                Math.min(request.timeoutMillis, 30_000),
              ),
            )
            results.push(toolchain)
            toolchainFingerprint = yield* products.digest(
              new TextEncoder().encode(
                JSON.stringify({
                  platform: request.platform,
                  architecture: process.arch,
                  expoRevision: request.expoRevision,
                  output: toolchain.result.observations.map(({ stream, text }) => ({
                    stream,
                    text,
                  })),
                }),
              ),
            )
            if (config.ccacheEnabled) {
              results.push(
                yield* commands.run(request, "prebuild", "ccache-reset.ndjson", {
                  command: "ccache",
                  args: ["--zero-stats"],
                  cwd: appDirectory,
                  timeoutMillis: Math.min(request.timeoutMillis, 30_000),
                }),
              )
            }
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
              const restored = yield* nativeCache.restore({
                request,
                appDirectory,
                output,
                nativeFingerprint,
                toolchainFingerprint,
              })
              nativeCacheArtifacts.push(...restored.artifacts)
              nativeCachePhases.push(...restored.phases)
              nativeCacheStatus = {
                name: "native-artifact",
                status: cacheHitStatus(restored.hit),
                key: restored.key,
                detail: restored.reason,
              }
              if (restored.hit) {
                buildDecision = "repack"
                nativeCacheEvidence = {
                  cacheKey: restored.key,
                  source: "native-cache",
                  sourceBuildId: restored.sourceBuildId!,
                  artifactHash: restored.artifactHash!,
                  validated: true,
                }
              } else {
                results.push(
                  yield* commands.run(request, "build", "process-2.ndjson", {
                    command: path.join(appDirectory, "android", "gradlew"),
                    args: [
                      "--build-cache",
                      "--no-configuration-cache",
                      ":app:assembleRelease",
                      "--no-daemon",
                      "--stacktrace",
                    ],
                    cwd: path.join(appDirectory, "android"),
                    env: commonEnv,
                    timeoutMillis: request.timeoutMillis,
                  }),
                )
                const published = yield* nativeCache.publish({
                  request,
                  appDirectory,
                  output,
                  nativeFingerprint,
                  toolchainFingerprint,
                })
                nativeCacheEvidence = {
                  cacheKey: published.key,
                  source: "full-build",
                  sourceBuildId: published.sourceBuildId!,
                  artifactHash: published.artifactHash!,
                  validated: true,
                }
              }
            } else {
              const iosDirectory = path.join(appDirectory, "ios")
              const derived = path.join(workspaceRoot, "derived-data")
              const architecture = process.arch === "arm64" ? "arm64" : "x86_64"
              const destination = config.iosDestination
              output = path.join(
                derived,
                "Build",
                "Products",
                "Release-iphonesimulator",
                "BetterNativeCompatibility.app",
              )
              const restored = yield* nativeCache.restore({
                request,
                appDirectory,
                output,
                nativeFingerprint,
                toolchainFingerprint,
              })
              nativeCacheArtifacts.push(...restored.artifacts)
              nativeCachePhases.push(...restored.phases)
              nativeCacheStatus = {
                name: "native-artifact",
                status: cacheHitStatus(restored.hit),
                key: restored.key,
                detail: restored.reason,
              }
              if (restored.hit) {
                buildDecision = "repack"
                nativeCacheEvidence = {
                  cacheKey: restored.key,
                  source: "native-cache",
                  sourceBuildId: restored.sourceBuildId!,
                  artifactHash: restored.artifactHash!,
                  validated: true,
                }
              } else {
                const podsCacheDirectory = path.join(
                  root,
                  ".artifacts",
                  "pods-cache",
                  "v1",
                  `${process.arch}-${toolchainFingerprint}-${nativeFingerprint}`,
                )
                const cachedPods = path.join(podsCacheDirectory, "Pods")
                const cachedLock = path.join(podsCacheDirectory, "Podfile.lock")
                const podsDirectory = path.join(iosDirectory, "Pods")
                const podfileLock = path.join(iosDirectory, "Podfile.lock")
                if ((yield* fs.exists(cachedPods)) && (yield* fs.exists(cachedLock))) {
                  yield* fs.copy(cachedPods, podsDirectory)
                  yield* fs.copyFile(cachedLock, podfileLock)
                  podsCacheStatus = {
                    name: "cocoapods",
                    status: "hit",
                    key: `${process.arch}-${toolchainFingerprint}-${nativeFingerprint}`,
                    detail: "restored generated Pods and Podfile.lock",
                  }
                } else {
                  podsCacheStatus = {
                    name: "cocoapods",
                    status: "miss",
                    key: `${process.arch}-${toolchainFingerprint}-${nativeFingerprint}`,
                    detail: "generated Pods cache entry is missing",
                  }
                }
                results.push(
                  yield* commands.run(request, "build", "process-2.ndjson", {
                    command: "pod",
                    args: ["install"],
                    cwd: iosDirectory,
                    env: commonEnv,
                    timeoutMillis: request.timeoutMillis,
                  }),
                )
                const manifestLock = path.join(podsDirectory, "Manifest.lock")
                const [podfileContents, manifestContents] = yield* Effect.all([
                  fs.readFileString(podfileLock),
                  fs.readFileString(manifestLock),
                ])
                if (podfileContents !== manifestContents) {
                  return yield* new BuildPipelineError({
                    phase: "build",
                    request,
                    cause:
                      "CocoaPods lock invariant failed: Podfile.lock differs from Pods/Manifest.lock",
                  })
                }
                if (yield* fs.exists(podsCacheDirectory))
                  yield* fs.remove(podsCacheDirectory, { recursive: true })
                yield* fs.makeDirectory(podsCacheDirectory, { recursive: true })
                yield* fs.copy(podsDirectory, cachedPods)
                yield* fs.copyFile(podfileLock, cachedLock)
                results.push(
                  yield* commands.run(request, "build", "process-3.ndjson", {
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
                      "-destination",
                      destination,
                      "-derivedDataPath",
                      derived,
                      `ARCHS=${architecture}`,
                      "ONLY_ACTIVE_ARCH=YES",
                      "build",
                    ],
                    cwd: iosDirectory,
                    env: commonEnv,
                    timeoutMillis: request.timeoutMillis,
                  }),
                )
                const published = yield* nativeCache.publish({
                  request,
                  appDirectory,
                  output,
                  nativeFingerprint,
                  toolchainFingerprint,
                })
                nativeCacheEvidence = {
                  cacheKey: published.key,
                  source: "full-build",
                  sourceBuildId: published.sourceBuildId!,
                  artifactHash: published.artifactHash!,
                  validated: true,
                }
              }
            }
            if (config.ccacheEnabled) {
              results.push(
                yield* commands.run(request, "evidence", "ccache-statistics.ndjson", {
                  command: "ccache",
                  args: ["--show-stats", "--verbose"],
                  cwd: appDirectory,
                  timeoutMillis: Math.min(request.timeoutMillis, 30_000),
                }),
              )
            }
          }
          // Keep the verbose materialization logs once under the pair ID. Each
          // portable build record receives a compact, hash-addressed attestation.
          const materializationArtifact = yield* commands
            .persistObservations(request, "upstream-materialization.ndjson", [
              {
                sequence: 0,
                timestampMillis: 0,
                stream: "stdout",
                text: JSON.stringify({
                  expoRevision: request.expoRevision,
                  artifacts: pinnedUpstream.artifacts.map(({ id, hash }) => ({ id, hash })),
                  expoPackageResolutions: prepared.expoPackageResolutions.map(
                    ({ name, source }) => ({
                      name,
                      source: path.relative(pinnedUpstream.root, source),
                    }),
                  ),
                }),
              },
            ])
            .pipe(
              Effect.mapError(
                (cause) => new BuildPipelineError({ phase: "evidence", request, cause }),
              ),
            )
          const artifacts = [
            materializationArtifact,
            ...results.map(({ artifact }) => artifact),
            ...nativeCacheArtifacts,
          ]
          const bundleHash = yield* products
            .hash(output)
            .pipe(
              Effect.mapError(
                (cause) => new BuildPipelineError({ phase: "build", request, cause }),
              ),
            )
          const configurationHash = yield* products
            .digest(
              new TextEncoder().encode(
                JSON.stringify({
                  mode: request.mode,
                  platform: request.platform,
                  expoRevision: request.expoRevision,
                  candidateRevision: request.candidateRevision,
                  probeSpecifier: request.probeSpecifier ?? null,
                }),
              ),
            )
            .pipe(
              Effect.mapError(
                (cause) => new BuildPipelineError({ phase: "evidence", request, cause }),
              ),
            )
          const platformCaches: Array<BuildRecordType["performance"]["caches"][number]> = []
          if (request.platform === "android") {
            const gradleHits = results.reduce(
              (count, { result }) =>
                count +
                result.observations.reduce(
                  (matches, { text }) => matches + (text.match(/FROM-CACHE/g) ?? []).length,
                  0,
                ),
              0,
            )
            platformCaches.push({
              name: "gradle-build-cache",
              status: gradleHits > 0 ? "hit" : "miss",
              key: config.caches.gradle.key,
              detail: `${gradleHits} task output(s) restored from cache`,
            })
          }
          if (request.platform === "ios") {
            platformCaches.push({
              name: "cocoapods-action-cache",
              status: config.caches.pods.status,
              key: config.caches.pods.key,
              detail: null,
            })
          }
          if (request.platform !== "web") {
            platformCaches.push({
              name: "ccache",
              status: config.caches.ccache.status,
              key: config.caches.ccache.key,
              detail: null,
            })
          }
          const record: BuildRecordType = {
            schemaVersion: 2,
            id: BuildId.make(request.id),
            mode: request.mode,
            platform: request.platform,
            expoRevision: request.expoRevision,
            candidateRevision: request.candidateRevision,
            configurationHash,
            bundleHash,
            nativeBinaryHash: Match.value(request.platform).pipe(
              Match.when("web", () => null),
              Match.whenOr("ios", "android", () => bundleHash),
              Match.exhaustive,
            ),
            nativeFingerprint,
            toolchainFingerprint,
            buildDecision,
            nativeArtifact: nativeCacheEvidence,
            performance: {
              architecture: process.arch,
              phases: [
                ...pinnedUpstream.performance.phases,
                ...results.map(({ phase }) => phase),
                ...nativeCachePhases,
              ],
              caches: [
                ...pinnedUpstream.performance.caches,
                ...(nativeCacheStatus === null ? [] : [nativeCacheStatus]),
                ...(podsCacheStatus === null ? [] : [podsCacheStatus]),
                ...platformCaches,
              ],
            },
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
            workspace: workspaceRoot,
            appDirectory,
            output,
            expoCli,
            observations: [
              ...pinnedUpstream.observations,
              ...results.flatMap(({ result }) => result.observations),
            ],
          }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase: "build", request, cause }),
          ),
        )
      return AppBuildExecutor.of({ execute })
    }),
  )
