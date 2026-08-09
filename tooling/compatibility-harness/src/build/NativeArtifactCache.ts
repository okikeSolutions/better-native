import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { createHash } from "node:crypto"
import {
  BuildId,
  ContentHash,
  isSafePathSegment,
  type Artifact,
  type BuildRecord,
} from "../Domain.ts"
import { HarnessConfig } from "../HarnessConfig.ts"
import { BuildCommand } from "./BuildCommand.ts"
import { applyBuildProfile, buildProfileEnvironment } from "./BuildProfile.ts"
import { BuildPipelineError, type BuildRequest } from "./BuildModel.ts"
import { BuildProducts } from "./BuildProducts.ts"

/** Versioned metadata binding a cached native artifact to its build inputs. */
export const NativeArtifactCacheRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  platform: Schema.Literals(["ios", "android"]),
  architecture: Schema.String,
  expoRevision: Schema.String,
  nativeFingerprint: Schema.String,
  toolchainFingerprint: ContentHash,
  sourceBuildId: BuildId,
  artifactHash: ContentHash,
  iosTarget: Schema.optional(Schema.Literals(["simulator", "device"])),
  iosSigningIdentity: Schema.optional(Schema.String),
})
/** Decoded cache metadata accepted by {@link NativeArtifactCacheRecord}. */
export type NativeArtifactCacheRecord = Schema.Schema.Type<typeof NativeArtifactCacheRecord>

class NativeCacheMetadataError extends Data.TaggedError("NativeCacheMetadataError")<{
  readonly cause: unknown
}> {}

/** Inputs used to locate or publish one native artifact cache entry. */
export interface NativeCacheRequest {
  readonly request: BuildRequest
  readonly appDirectory: string
  readonly metroNodeModules: string
  readonly output: string
  readonly nativeFingerprint: string
  readonly toolchainFingerprint: ContentHash
}

/** Cache hit/miss result and provenance returned to the build pipeline. */
export interface NativeCacheRestore {
  readonly hit: boolean
  /** Whether a matching cached shell was found but repacking or verification failed. */
  readonly repackFailure: boolean
  readonly key: string
  readonly sourceBuildId: BuildId | null
  readonly artifactHash: ContentHash | null
  readonly reason: string
  readonly artifacts: ReadonlyArray<Artifact>
  readonly phases: ReadonlyArray<BuildRecord["performance"]["phases"][number]>
}

export interface NativeCacheKeySeed {
  readonly request: BuildRequest
  readonly nativeFingerprint: string
}

/**
 * Computes the cache identity for a platform native artifact.
 *
 * @remarks
 * The key includes platform/target, signing identity, host architecture, Expo revision, native
 * fingerprint, and toolchain fingerprint. Run identity and mode are intentionally absent so a
 * paired build can reuse one native shell.
 *
 * @param input - Build and fingerprint inputs for the artifact.
 * @param architecture - Host architecture used by the native toolchain.
 * @returns A path-safe deterministic cache key.
 */
export const nativeArtifactCacheKey = (
  input: Pick<NativeCacheRequest, "request" | "nativeFingerprint" | "toolchainFingerprint">,
  architecture: string = process.arch,
  iosTarget: "simulator" | "device" = "simulator",
  iosSigningIdentity = "unsigned",
): string => {
  const labels = [
    input.request.platform,
    ...(input.request.platform === "ios" ? [iosTarget] : []),
    architecture,
  ]
  const safeComponents = [
    ...labels,
    input.request.expoRevision,
    input.toolchainFingerprint,
    input.nativeFingerprint,
  ]
  const invalid = safeComponents.find((component) => !isSafePathSegment(component))
  if (invalid !== undefined) throw new Error(`invalid native cache key component: ${invalid}`)
  const identity = createHash("sha256")
    .update(
      JSON.stringify({
        platform: input.request.platform,
        iosTarget: input.request.platform === "ios" ? iosTarget : null,
        iosSigningIdentity: input.request.platform === "ios" ? iosSigningIdentity : null,
        architecture,
        expoRevision: input.request.expoRevision,
        toolchainFingerprint: input.toolchainFingerprint,
        nativeFingerprint: input.nativeFingerprint,
      }),
    )
    .digest("hex")
  return validateNativeArtifactCacheKey([...labels, identity].join("-"))
}

const validateNativeArtifactCacheKey = (key: string): string => {
  if (!isSafePathSegment(key)) throw new Error(`invalid native cache key: ${key}`)
  return key
}

/**
 * Validates every cache-key component available before Java or Xcode is launched.
 */
export const nativeArtifactCacheKeySeed = (
  input: NativeCacheKeySeed,
  architecture: string = process.arch,
  iosTarget: "simulator" | "device" = "simulator",
  iosSigningIdentity = "unsigned",
): string =>
  nativeArtifactCacheKey(
    {
      request: input.request,
      nativeFingerprint: input.nativeFingerprint,
      toolchainFingerprint: ContentHash.make("0".repeat(64)),
    },
    architecture,
    iosTarget,
    iosSigningIdentity,
  )

/**
 * Selects the native product name for a supported build platform.
 *
 * @param platform - Build platform.
 * @returns Native product metadata, or `null` for web builds.
 */
export const nativeArtifact = (
  platform: BuildRequest["platform"],
): { readonly platform: "ios" | "android"; readonly name: string } | null =>
  Match.value(platform).pipe(
    Match.when("ios", () => ({ platform: "ios" as const, name: "BetterNativeCompatibility.app" })),
    Match.when("android", () => ({ platform: "android" as const, name: "app-release.apk" })),
    Match.when("web", () => null),
    Match.exhaustive,
  )

/**
 * Returns the native product filename for a platform, if one exists.
 *
 * @param platform - Build platform.
 * @returns The product filename, or `null` for web builds.
 */
export const nativeArtifactName = (platform: BuildRequest["platform"]): string | null =>
  nativeArtifact(platform)?.name ?? null

/**
 * Explains why a cached native artifact cannot satisfy a build request.
 *
 * @remarks
 * Checks are ordered from coarse platform identity to toolchain identity so
 * diagnostics identify the first invalid cache dimension.
 *
 * @param record - Metadata persisted with the cached artifact.
 * @param input - Current build request and fingerprints.
 * @param architecture - Host architecture used by the current toolchain.
 * @returns The mismatching dimension, or `null` when all dimensions match.
 */
export const nativeArtifactCacheMismatch = (
  record: NativeArtifactCacheRecord,
  input: NativeCacheRequest,
  architecture: string = process.arch,
  iosTarget: "simulator" | "device" = "simulator",
  iosSigningIdentity = "unsigned",
): string | null => {
  if (record.platform !== input.request.platform) return "platform"
  if (record.architecture !== architecture) return "architecture"
  if (input.request.platform === "ios" && (record.iosTarget ?? "simulator") !== iosTarget) {
    return "ios-target"
  }
  if (
    input.request.platform === "ios" &&
    iosTarget === "device" &&
    record.iosSigningIdentity !== iosSigningIdentity
  ) {
    return "ios-signing-identity"
  }
  if (record.expoRevision !== input.request.expoRevision) return "expo-revision"
  if (record.nativeFingerprint !== input.nativeFingerprint) return "native-fingerprint"
  if (record.toolchainFingerprint !== input.toolchainFingerprint) return "toolchain-fingerprint"
  return null
}

const cacheMiss = (
  cacheKey: string,
  reason: string,
  artifacts: ReadonlyArray<Artifact> = [],
  phases: ReadonlyArray<BuildRecord["performance"]["phases"][number]> = [],
  repackFailure = false,
): NativeCacheRestore => ({
  hit: false,
  repackFailure,
  key: cacheKey,
  sourceBuildId: null,
  artifactHash: null,
  reason,
  artifacts,
  phases,
})

interface Service {
  readonly validateKeySeed: (input: NativeCacheKeySeed) => Effect.Effect<string, BuildPipelineError>
  readonly restore: (
    input: NativeCacheRequest,
  ) => Effect.Effect<NativeCacheRestore, BuildPipelineError>
  readonly publish: (
    input: NativeCacheRequest,
  ) => Effect.Effect<NativeCacheRestore, BuildPipelineError>
}

/** Effect context tag for reusable native build artifacts. */
export class NativeArtifactCache extends Context.Service<NativeArtifactCache, Service>()(
  "@better-native/compatibility-harness/NativeArtifactCache",
) {}

const repackModulePath = fileURLToPath(import.meta.resolve("@expo/repack-app"))

/**
 * Builds native caching with product hashing and shared build services.
 *
 * @param root - Better Native repository root.
 * @returns A layer providing {@link NativeArtifactCache}.
 */
export const layer = (
  root: string,
): Layer.Layer<
  NativeArtifactCache,
  never,
  BuildCommand | BuildProducts | FileSystem.FileSystem | Path.Path | HarnessConfig
> =>
  Layer.effect(
    NativeArtifactCache,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const commands = yield* BuildCommand
      const products = yield* BuildProducts
      const config = yield* HarnessConfig
      const cacheRoot = path.join(root, ".artifacts", "native-cache", "v1")
      const iosTarget = config.iosDestination.toLowerCase().includes("simulator")
        ? "simulator"
        : "device"
      const iosSigningIdentity = `${config.iosDevelopmentTeam ?? "automatic"}|${config.iosCodeSignIdentity}`
      const validateKeySeed: Service["validateKeySeed"] = (input) =>
        Effect.try({
          try: () => nativeArtifactCacheKeySeed(input, process.arch, iosTarget, iosSigningIdentity),
          catch: (cause) =>
            new BuildPipelineError({ phase: "prebuild", request: input.request, cause }),
        })
      const locations = (input: NativeCacheRequest) => {
        const artifact = nativeArtifact(input.request.platform)
        if (artifact === null) return null
        const cacheKey = nativeArtifactCacheKey(input, process.arch, iosTarget, iosSigningIdentity)
        const directory = path.join(cacheRoot, cacheKey)
        return {
          cacheKey,
          directory,
          artifact: path.join(directory, artifact.name),
          platform: artifact.platform,
          record: path.join(directory, "record.json"),
          lock: `${directory}.lock`,
        }
      }
      const withCacheLock = <A, E>(
        lockPath: string,
        onBusy: A,
        effect: Effect.Effect<A, E>,
      ): Effect.Effect<A, E> =>
        Effect.acquireUseRelease(
          fs.makeDirectory(path.dirname(lockPath), { recursive: true }).pipe(
            Effect.andThen(Effect.sync(randomUUID)),
            Effect.flatMap((token) =>
              fs.writeFileString(lockPath, token, { flag: "wx" }).pipe(Effect.as(token)),
            ),
            Effect.orElseSucceed(() => null),
          ),
          (token) => (token === null ? Effect.succeed(onBusy) : effect),
          (token) =>
            token === null
              ? Effect.void
              : fs.readFileString(lockPath).pipe(
                  Effect.flatMap((current) =>
                    current === token ? fs.remove(lockPath) : Effect.void,
                  ),
                  Effect.ignore,
                ),
        )
      const restoreUnlocked: Service["restore"] = (input) =>
        Effect.gen(function* () {
          const location = locations(input)
          if (location === null) {
            return cacheMiss("web", "native cache is not applicable to web")
          }
          if (config.forceColdBuild) {
            return cacheMiss(location.cacheKey, "cold-build policy bypassed native artifact reuse")
          }
          if (!(yield* fs.exists(location.record)) || !(yield* fs.exists(location.artifact))) {
            return cacheMiss(location.cacheKey, "cache entry is missing")
          }
          const decoded = yield* fs.readFileString(location.record).pipe(
            Effect.flatMap((text) =>
              Effect.try({
                try: () => JSON.parse(text) as unknown,
                catch: (cause) => new NativeCacheMetadataError({ cause }),
              }),
            ),
            Effect.flatMap(Schema.decodeUnknownEffect(NativeArtifactCacheRecord)),
            Effect.option,
          )
          if (decoded._tag === "None") {
            return cacheMiss(location.cacheKey, "cache metadata is malformed")
          }
          const record = decoded.value
          const mismatch = nativeArtifactCacheMismatch(
            record,
            input,
            process.arch,
            iosTarget,
            iosSigningIdentity,
          )
          if (mismatch !== null) {
            return cacheMiss(location.cacheKey, `cache metadata mismatch: ${mismatch}`)
          }
          const actualHash = yield* products.hash(location.artifact)
          if (actualHash !== record.artifactHash) {
            return cacheMiss(location.cacheKey, "cached native artifact hash is invalid")
          }
          const accessedAt = new Date()
          yield* fs.utimes(location.directory, accessedAt, accessedAt)
          if (yield* fs.exists(input.output)) yield* fs.remove(input.output, { recursive: true })
          yield* fs.makeDirectory(path.dirname(input.output), { recursive: true })
          const resolutionEvidencePath = path.join(
            input.appDirectory,
            `.better-native-resolution-${input.request.id}.ndjson`,
          )
          if (yield* fs.exists(resolutionEvidencePath)) yield* fs.remove(resolutionEvidencePath)
          const repack = yield* commands
            .run(
              input.request,
              "build",
              "native-repack.ndjson",
              applyBuildProfile(config.buildProfile, "metro-wrapper", {
                command: "node",
                args: [
                  path.join(path.dirname(repackModulePath), "..", "bin", "cli.js"),
                  "--platform",
                  input.request.platform,
                  "--source-app",
                  location.artifact,
                  "--working-directory",
                  path.join(input.appDirectory, ".native-repack"),
                  "--output",
                  input.output,
                  "--js-bundle-only",
                  input.appDirectory,
                ],
                cwd: input.appDirectory,
                env: {
                  ...buildProfileEnvironment(config.buildProfile),
                  NODE_ENV: "production",
                  BETTER_NATIVE_MODE: input.request.mode,
                  BETTER_NATIVE_BUILD_ID: input.request.id,
                  BETTER_NATIVE_RUN_ID: `build-${input.request.id}`,
                  BETTER_NATIVE_UPSTREAM_NODE_MODULES: input.metroNodeModules,
                  BETTER_NATIVE_PINNED_EXPO_ROOT: config.expoSourceRoot,
                  EXPO_SOURCE_ROOT: config.expoSourceRoot,
                  BETTER_NATIVE_RESOLUTION_EVIDENCE_PATH: resolutionEvidencePath,
                  ANDROID_HOME: config.androidSdkRoot ?? undefined,
                  ANDROID_SDK_ROOT: config.androidSdkRoot ?? undefined,
                },
                timeoutMillis: input.request.timeoutMillis,
              }),
            )
            .pipe(Effect.option)
          if (repack._tag === "None" || !(yield* fs.exists(input.output))) {
            if (yield* fs.exists(input.output)) yield* fs.remove(input.output, { recursive: true })
            return cacheMiss(location.cacheKey, "Expo repack failed", [], [], true)
          }
          const signing =
            location.platform === "ios" && iosTarget === "device"
              ? yield* commands
                  .run(input.request, "build", "native-repack-signing.ndjson", {
                    command: "codesign",
                    args: [
                      "--force",
                      "--sign",
                      config.iosCodeSignIdentity,
                      "--preserve-metadata=identifier,entitlements,flags,runtime",
                      "--timestamp=none",
                      input.output,
                    ],
                    cwd: input.appDirectory,
                    timeoutMillis: Math.min(input.request.timeoutMillis, 120_000),
                  })
                  .pipe(Effect.option)
              : null
          if (location.platform === "ios" && iosTarget === "device" && signing?._tag !== "Some") {
            if (yield* fs.exists(input.output)) yield* fs.remove(input.output, { recursive: true })
            return cacheMiss(location.cacheKey, "physical iOS repack signing failed", [], [], true)
          }
          const verification =
            signing?._tag === "Some"
              ? yield* commands
                  .run(input.request, "build", "native-repack-signature-verification.ndjson", {
                    command: "codesign",
                    args: ["--verify", "--deep", "--strict", "--verbose=2", input.output],
                    cwd: input.appDirectory,
                    timeoutMillis: Math.min(input.request.timeoutMillis, 120_000),
                  })
                  .pipe(Effect.option)
              : null
          if (signing?._tag === "Some" && verification?._tag !== "Some") {
            if (yield* fs.exists(input.output)) yield* fs.remove(input.output, { recursive: true })
            return cacheMiss(
              location.cacheKey,
              "physical iOS repack signature verification failed",
              [],
              [],
              true,
            )
          }
          const resolutionArtifact = (yield* fs.exists(resolutionEvidencePath))
            ? yield* fs.readFileString(resolutionEvidencePath).pipe(
                Effect.flatMap((text) =>
                  commands.persistObservations(
                    input.request,
                    "native-repack-resolutions.ndjson",
                    text
                      .split("\n")
                      .filter((line) => line.length > 0)
                      .map((lineText, sequence) => ({
                        sequence,
                        timestampMillis: 0,
                        stream: "stdout" as const,
                        text: lineText,
                      })),
                  ),
                ),
              )
            : null
          return {
            hit: true,
            repackFailure: false,
            key: location.cacheKey,
            sourceBuildId: record.sourceBuildId,
            artifactHash: record.artifactHash,
            reason: "validated native artifact was repacked with the current JS bundle and assets",
            artifacts: [
              repack.value.artifact,
              ...(signing?._tag === "Some" ? [signing.value.artifact] : []),
              ...(verification?._tag === "Some" ? [verification.value.artifact] : []),
              ...(resolutionArtifact === null ? [] : [resolutionArtifact]),
            ],
            phases: [
              repack.value.phase,
              ...(signing?._tag === "Some" ? [signing.value.phase] : []),
              ...(verification?._tag === "Some" ? [verification.value.phase] : []),
            ],
          }
        }).pipe(
          Effect.mapError(
            (cause) => new BuildPipelineError({ phase: "build", request: input.request, cause }),
          ),
        )
      const publishUnlocked: Service["publish"] = (input) =>
        Effect.gen(function* () {
          const location = locations(input)
          if (location === null) return cacheMiss("web", "not applicable")
          const artifactHash = yield* products.hash(input.output)
          const temporary = `${location.directory}.tmp-${process.pid}`
          if (yield* fs.exists(temporary)) yield* fs.remove(temporary, { recursive: true })
          yield* fs.makeDirectory(temporary, { recursive: true })
          const temporaryArtifact = path.join(temporary, path.basename(location.artifact))
          yield* fs.copy(input.output, temporaryArtifact)
          const encoded = yield* Schema.encodeEffect(NativeArtifactCacheRecord)({
            schemaVersion: 1,
            platform: location.platform,
            architecture: process.arch,
            expoRevision: input.request.expoRevision,
            nativeFingerprint: input.nativeFingerprint,
            toolchainFingerprint: input.toolchainFingerprint,
            sourceBuildId: BuildId.make(input.request.id),
            artifactHash,
            ...(input.request.platform === "ios" ? { iosTarget } : {}),
            ...(input.request.platform === "ios" && iosTarget === "device"
              ? { iosSigningIdentity }
              : {}),
          })
          yield* fs.writeFileString(
            path.join(temporary, "record.json"),
            `${JSON.stringify(encoded, null, 2)}\n`,
          )
          if (yield* fs.exists(location.directory))
            yield* fs.remove(location.directory, { recursive: true })
          yield* fs.makeDirectory(path.dirname(location.directory), { recursive: true })
          yield* fs.rename(temporary, location.directory)
          const publishedAt = new Date()
          yield* fs.utimes(location.directory, publishedAt, publishedAt)
          return {
            hit: false,
            repackFailure: false,
            key: location.cacheKey,
            sourceBuildId: BuildId.make(input.request.id),
            artifactHash,
            reason: "full build published a validated native artifact",
            artifacts: [],
            phases: [],
          }
        }).pipe(
          Effect.mapError(
            (cause) => new BuildPipelineError({ phase: "evidence", request: input.request, cause }),
          ),
        )
      const restore: Service["restore"] = (input) => {
        const location = locations(input)
        return location === null
          ? restoreUnlocked(input)
          : withCacheLock(
              location.lock,
              cacheMiss(location.cacheKey, "cache entry is busy"),
              restoreUnlocked(input),
            )
      }
      const publish: Service["publish"] = (input) => {
        const location = locations(input)
        return location === null
          ? publishUnlocked(input)
          : withCacheLock(
              location.lock,
              cacheMiss(location.cacheKey, "cache entry is busy; publication skipped"),
              publishUnlocked(input),
            )
      }
      return NativeArtifactCache.of({ validateKeySeed, restore, publish })
    }),
  )
