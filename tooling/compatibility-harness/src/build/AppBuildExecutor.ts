import { createFingerprintAsync } from "@expo/fingerprint"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import { BuildId, BuildRecord, type BuildRecord as BuildRecordType } from "../Domain.ts"
import { ArtifactLifecycle } from "../artifacts/ArtifactLifecycle.ts"
import { EvidenceStore } from "../evidence/EvidenceStore.ts"
import { HarnessConfig } from "../HarnessConfig.ts"
import { AppWorkspace, workspaceName } from "./AppWorkspace.ts"
import { BuildCommand, type BuildCommandResult } from "./BuildCommand.ts"
import {
  BuildPipelineError,
  ensureNativeRebuildAllowed,
  type BuildOutput,
  type BuildRequest,
  type PinnedExpoToolchain,
} from "./BuildModel.ts"
import { BuildProducts } from "./BuildProducts.ts"
import {
  androidArchitecturesFor,
  applyBuildProfile,
  buildProfileEnvironment,
} from "./BuildProfile.ts"
import { NativeArtifactCache, nativeArtifactName } from "./NativeArtifactCache.ts"
import {
  canonicalNativeFingerprintSources,
  nativeClosureFingerprintInput,
} from "./NativeFingerprint.ts"
import {
  discoverNativeExpoPackages,
  discoverReactNativePackages,
  validateNativeResolution,
} from "./NativeResolution.ts"
import { PodsCache } from "./PodsCache.ts"

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

const nativeToolchainCommand = (
  platform: "ios" | "android",
  cwd: string,
  timeoutMillis: number,
  javaHome17: string | null,
) =>
  Match.value(platform).pipe(
    Match.when("ios", () => ({ command: "xcodebuild", args: ["-version"], cwd, timeoutMillis })),
    Match.when("android", () => ({
      command: `${javaHome17}/bin/java`,
      args: ["-version"],
      cwd,
      timeoutMillis,
    })),
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

const nativeCompilerInvocations = (
  buildDecision: "bundle" | "full-build" | "repack",
  platform: BuildRequest["platform"],
): Array<"gradle" | "cocoapods" | "xcode"> => {
  if (buildDecision !== "full-build") return []
  if (platform === "android") return ["gradle"]
  if (platform === "ios") return ["cocoapods", "xcode"]
  return []
}

/** Effect context tag for executing isolated compatibility app builds. */
export class AppBuildExecutor extends Context.Service<AppBuildExecutor, Service>()(
  "@better-native/compatibility-harness/AppBuildExecutor",
) {}

/**
 * Builds the app executor with shared workspace, command, cache, and evidence services.
 *
 * @param root - Better Native repository root.
 * @returns A layer providing {@link AppBuildExecutor}.
 */
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
  | PodsCache
  | ArtifactLifecycle
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
      const podsCache = yield* PodsCache
      const artifactLifecycle = yield* ArtifactLifecycle
      const config = yield* HarnessConfig
      const executeBuild: Service["execute"] = (request, pinnedUpstream) =>
        Effect.gen(function* () {
          if (request.platform === "android" && config.javaHome17 === null) {
            return yield* new BuildPipelineError({
              phase: "prebuild",
              request,
              cause:
                "JDK 17 is required; install it or set BETTER_NATIVE_JAVA_HOME_17 to a verified JDK 17 home",
            })
          }
          if (request.platform === "android" && config.androidSdkRoot === null) {
            return yield* new BuildPipelineError({
              phase: "prebuild",
              request,
              cause: "Android SDK is required; set ANDROID_SDK_ROOT or ANDROID_HOME",
            })
          }
          const prepared = yield* workspace.prepare(request, pinnedUpstream)
          const { appDirectory, workspace: workspaceRoot } = prepared
          const precompiledModulesPath = path.join(
            pinnedUpstream.root,
            "packages",
            "precompile",
            ".build",
          )
          const precompiledModulesArchive = path.join(
            precompiledModulesPath,
            "expo-modules-core",
            "output",
            "release",
            "xcframeworks",
            "ExpoModulesCore.tar.gz",
          )
          const precompiledModulesAvailable = yield* fs.exists(precompiledModulesArchive)
          const precompiledModulesHash = precompiledModulesAvailable
            ? yield* products.hash(precompiledModulesArchive)
            : null
          const commonEnv = {
            ...buildProfileEnvironment(config.buildProfile),
            BETTER_NATIVE_MODE: request.mode,
            BETTER_NATIVE_BUILD_ID: request.id,
            BETTER_NATIVE_RUN_ID: `build-${request.id}`,
            CI: "1",
            BETTER_NATIVE_UPSTREAM_NODE_MODULES: prepared.metroNodeModules,
            BETTER_NATIVE_PINNED_EXPO_ROOT: pinnedUpstream.root,
            CCACHE_BASEDIR: workspaceRoot,
            JAVA_HOME: config.javaHome17 ?? undefined,
            ANDROID_HOME: config.androidSdkRoot ?? undefined,
            ANDROID_SDK_ROOT: config.androidSdkRoot ?? undefined,
            PATH:
              config.javaHome17 === null
                ? config.executablePath
                : `${config.javaHome17}${path.sep}bin${process.platform === "win32" ? ";" : ":"}${config.executablePath}`,
            EXPO_PRECOMPILED_MODULES_PATH: precompiledModulesAvailable
              ? precompiledModulesPath
              : undefined,
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
          let autolinkedNativeModules = 0
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
            const reactNativePackageNames = yield* discoverReactNativePackages(
              reactNativeModules.result.observations,
            ).pipe(
              Effect.mapError(
                (cause) => new BuildPipelineError({ phase: "prebuild", request, cause }),
              ),
            )
            autolinkedNativeModules = new Set([...nativePackageNames, ...reactNativePackageNames])
              .size
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
              yield* commands.run(
                request,
                "build",
                "metro-export.ndjson",
                applyBuildProfile(config.buildProfile, "metro", {
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
              ),
            )
          } else {
            results.push(
              yield* commands.run(request, "prebuild", "native-prebuild.ndjson", {
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
            const pinnedExpoRelative = path
              .relative(appDirectory, pinnedUpstream.root)
              .replaceAll("\\", "/")
            const fingerprint = yield* Effect.tryPromise({
              try: () =>
                createFingerprintAsync(appDirectory, {
                  platforms: nativeFingerprintPlatform(request.platform),
                  silent: true,
                  // Pinned Expo packages materialize compiler output during a native build. These
                  // paths are products of the selected toolchain, not inputs to the native closure.
                  ignorePaths: [
                    "**/expo/packages/**/android/build/**/*",
                    "**/expo/packages/**/android/.cxx/**/*",
                    "**/expo/packages/**/ios/build/**/*",
                    "**/expo/packages/**/apple/Products/**/*",
                    "**/expo/packages/**/apple/.DerivedData/**/*",
                    "**/expo/packages/precompile/.build/**/*",
                    `${pinnedExpoRelative}/packages/**/android/build/**/*`,
                    `${pinnedExpoRelative}/packages/**/android/.cxx/**/*`,
                    `${pinnedExpoRelative}/packages/**/ios/build/**/*`,
                    `${pinnedExpoRelative}/packages/**/apple/Products/**/*`,
                    `${pinnedExpoRelative}/packages/**/apple/.DerivedData/**/*`,
                    `${pinnedExpoRelative}/packages/precompile/.build/**/*`,
                  ],
                }),
              catch: (cause) => new BuildPipelineError({ phase: "prebuild", request, cause }),
            })
            const canonicalFingerprintSources = canonicalNativeFingerprintSources(
              fingerprint.sources,
            )
            nativeFingerprint = yield* products.digest(
              nativeClosureFingerprintInput(canonicalFingerprintSources),
            )
            nativeCacheArtifacts.push(
              yield* commands.persistObservations(request, "native-fingerprint.ndjson", [
                {
                  sequence: 0,
                  timestampMillis: 0,
                  stream: "stdout",
                  text: JSON.stringify({
                    expoFingerprintHash: fingerprint.hash,
                    hash: nativeFingerprint,
                    excludedSourceCount:
                      fingerprint.sources.length - canonicalFingerprintSources.length,
                    sources: canonicalFingerprintSources,
                  }),
                },
              ]),
            )
            yield* nativeCache.validateKeySeed({ request, nativeFingerprint })
            const toolchain = yield* commands.run(
              request,
              "prebuild",
              "native-toolchain.ndjson",
              nativeToolchainCommand(
                request.platform,
                appDirectory,
                Math.min(request.timeoutMillis, 30_000),
                config.javaHome17,
              ),
            )
            results.push(toolchain)
            toolchainFingerprint = yield* products.digest(
              new TextEncoder().encode(
                JSON.stringify({
                  platform: request.platform,
                  architecture: process.arch,
                  expoRevision: request.expoRevision,
                  androidArchitectures:
                    request.platform === "android"
                      ? androidArchitecturesFor(config.buildProfile)
                      : null,
                  precompiledModulesHash,
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
                metroNodeModules: prepared.metroNodeModules,
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
              yield* ensureNativeRebuildAllowed(request, restored)
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
                  yield* Effect.scoped(
                    artifactLifecycle.acquireNativeBuild(`${request.platform}:${request.id}`).pipe(
                      Effect.mapError(
                        (cause) => new BuildPipelineError({ phase: "build", request, cause }),
                      ),
                      Effect.andThen(
                        commands.run(
                          request,
                          "build",
                          "gradle-release.ndjson",
                          applyBuildProfile(config.buildProfile, "gradle", {
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
                        ),
                      ),
                    ),
                  ),
                )
                const published = yield* nativeCache.publish({
                  request,
                  appDirectory,
                  metroNodeModules: prepared.metroNodeModules,
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
              const physicalDevice = !destination.toLowerCase().includes("simulator")
              const sdk = physicalDevice ? "iphoneos" : "iphonesimulator"
              if (physicalDevice && config.iosDevelopmentTeam === null) {
                return yield* new BuildPipelineError({
                  phase: "build",
                  request,
                  cause:
                    "physical iOS builds require BETTER_NATIVE_IOS_DEVELOPMENT_TEAM for deterministic signing",
                })
              }
              output = path.join(
                derived,
                "Build",
                "Products",
                `Release-${sdk}`,
                "BetterNativeCompatibility.app",
              )
              const restored = yield* nativeCache.restore({
                request,
                appDirectory,
                metroNodeModules: prepared.metroNodeModules,
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
              yield* ensureNativeRebuildAllowed(request, restored)
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
                const iosNativeFingerprint = nativeFingerprint
                const iosToolchainFingerprint = toolchainFingerprint
                yield* Effect.scoped(
                  artifactLifecycle.acquireNativeBuild(`${request.platform}:${request.id}`).pipe(
                    Effect.mapError(
                      (cause) => new BuildPipelineError({ phase: "build", request, cause }),
                    ),
                    Effect.andThen(
                      Effect.gen(function* () {
                        const podsDirectory = path.join(iosDirectory, "Pods")
                        const podfileLock = path.join(iosDirectory, "Podfile.lock")
                        const restoredPods = yield* podsCache.restore({
                          request,
                          iosDirectory,
                          workspaceRoot,
                          architecture,
                          toolchainFingerprint: iosToolchainFingerprint,
                          nativeFingerprint: iosNativeFingerprint,
                        })
                        podsCacheStatus = {
                          name: "cocoapods",
                          status: cacheHitStatus(restoredPods.hit),
                          key: restoredPods.key,
                          detail: restoredPods.detail,
                        }
                        results.push(
                          yield* commands.run(
                            request,
                            "build",
                            "cocoapods-install.ndjson",
                            applyBuildProfile(config.buildProfile, "cocoapods", {
                              command: "pod",
                              args: ["install"],
                              cwd: iosDirectory,
                              env: commonEnv,
                              timeoutMillis: request.timeoutMillis,
                            }),
                          ),
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
                        const publishedPods = yield* podsCache.publish({
                          request,
                          iosDirectory,
                          workspaceRoot,
                          architecture,
                          toolchainFingerprint: iosToolchainFingerprint,
                          nativeFingerprint: iosNativeFingerprint,
                        })
                        podsCacheStatus = {
                          name: "cocoapods",
                          status: restoredPods.hit ? "hit" : "miss",
                          key: publishedPods.key,
                          detail: restoredPods.hit ? restoredPods.detail : publishedPods.detail,
                        }
                        results.push(
                          yield* commands.run(
                            request,
                            "build",
                            "xcode-release.ndjson",
                            applyBuildProfile(config.buildProfile, "xcode", {
                              command: "xcodebuild",
                              args: [
                                "-workspace",
                                path.join(iosDirectory, "BetterNativeCompatibility.xcworkspace"),
                                "-scheme",
                                "BetterNativeCompatibility",
                                "-configuration",
                                "Release",
                                "-sdk",
                                sdk,
                                "-destination",
                                destination,
                                "-derivedDataPath",
                                derived,
                                `ARCHS=${architecture}`,
                                "ONLY_ACTIVE_ARCH=YES",
                                ...(physicalDevice
                                  ? [
                                      `DEVELOPMENT_TEAM=${config.iosDevelopmentTeam}`,
                                      "CODE_SIGN_STYLE=Automatic",
                                      "-allowProvisioningUpdates",
                                      "-allowProvisioningDeviceRegistration",
                                    ]
                                  : []),
                                "-showBuildTimingSummary",
                                "build",
                              ],
                              cwd: iosDirectory,
                              env: commonEnv,
                              timeoutMillis: request.timeoutMillis,
                            }),
                          ),
                        )
                        const published = yield* nativeCache.publish({
                          request,
                          appDirectory,
                          metroNodeModules: prepared.metroNodeModules,
                          output,
                          nativeFingerprint: iosNativeFingerprint,
                          toolchainFingerprint: iosToolchainFingerprint,
                        })
                        nativeCacheEvidence = {
                          cacheKey: published.key,
                          source: "full-build",
                          sourceBuildId: published.sourceBuildId!,
                          artifactHash: published.artifactHash!,
                          validated: true,
                        }
                      }),
                    ),
                  ),
                )
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
                  capabilitySource: request.capabilitySource ?? null,
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
            platformCaches.push({
              name: "expo-precompiled-modules",
              status: precompiledModulesAvailable ? "hit" : "miss",
              key: request.expoRevision,
              detail: precompiledModulesAvailable
                ? `using pinned XCFrameworks from ${precompiledModulesPath}`
                : "ExpoModulesCore Release XCFramework is absent; Expo modules compile from source",
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
            capabilitySource: request.capabilitySource ?? null,
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
              policy: {
                profile: config.buildProfile,
                workerCeiling: config.buildProfile === "polite" ? 2 : null,
                cpuCeiling: config.buildProfile === "polite" ? 2 : null,
                darwinScheduling: config.buildProfile === "polite" ? "utility-background" : null,
                maxSimultaneousNativeBuilds: 1,
                androidAbis:
                  request.platform === "android" &&
                  androidArchitecturesFor(config.buildProfile) !== null
                    ? [androidArchitecturesFor(config.buildProfile)!]
                    : [],
              },
              dependencyCounts: {
                directRuntimeDependencies: prepared.directRuntimeDependencyCount,
                nativeRoots: prepared.nativeRootCount,
                metroClosure: prepared.metroClosureCount,
                autolinkedNativeModules,
              },
              nativeCompilerInvocations: nativeCompilerInvocations(buildDecision, request.platform),
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
          if (request.platform !== "web") {
            const name = nativeArtifactName(request.platform)
            if (name === null) {
              return yield* new BuildPipelineError({
                phase: "evidence",
                request,
                cause: `missing native product name for ${request.platform}`,
              })
            }
            output = yield* artifactLifecycle
              .publishNativeProduct({
                workspace: workspaceRoot,
                source: output,
                buildId: request.id,
                name,
              })
              .pipe(
                Effect.mapError(
                  (cause) => new BuildPipelineError({ phase: "evidence", request, cause }),
                ),
              )
          }
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
      const execute: Service["execute"] = (request, pinnedUpstream) =>
        artifactLifecycle.pruneBeforeBuild.pipe(
          Effect.mapError(
            (cause) => new BuildPipelineError({ phase: "workspace", request, cause }),
          ),
          Effect.andThen(
            Effect.scoped(
              artifactLifecycle
                .acquireWorkspace(
                  path.join(root, ".artifacts", "workspaces", workspaceName(request)),
                )
                .pipe(Effect.andThen(executeBuild(request, pinnedUpstream))),
            ),
          ),
          Effect.tap(() =>
            request.platform === "web"
              ? Effect.void
              : artifactLifecycle.prune({ dryRun: false }).pipe(Effect.ignore),
          ),
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase: "workspace", request, cause }),
          ),
        )
      return AppBuildExecutor.of({ execute })
    }),
  )
