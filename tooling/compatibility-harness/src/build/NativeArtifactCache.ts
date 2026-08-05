import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { fileURLToPath } from "node:url"
import {
  BuildId,
  ContentHash,
  isSafePathSegment,
  type Artifact,
  type BuildRecord,
} from "../Domain.ts"
import { HarnessConfig } from "../HarnessConfig.ts"
import { BuildCommand } from "./BuildCommand.ts"
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
  readonly output: string
  readonly nativeFingerprint: string
  readonly toolchainFingerprint: ContentHash
}

/** Cache hit/miss result and provenance returned to the build pipeline. */
export interface NativeCacheRestore {
  readonly hit: boolean
  readonly key: string
  readonly sourceBuildId: BuildId | null
  readonly artifactHash: ContentHash | null
  readonly reason: string
  readonly artifacts: ReadonlyArray<Artifact>
  readonly phases: ReadonlyArray<BuildRecord["performance"]["phases"][number]>
}

/**
 * Computes the cache identity for a platform native artifact.
 *
 * @remarks
 * The key includes platform, host architecture, native fingerprint, and
 * toolchain fingerprint. Omitting any component could reuse a binary built
 * from incompatible native inputs.
 *
 * @param input - Build and fingerprint inputs for the artifact.
 * @param architecture - Host architecture used by the native toolchain.
 * @returns A path-safe deterministic cache key.
 */
export const nativeArtifactCacheKey = (
  input: Pick<NativeCacheRequest, "request" | "nativeFingerprint" | "toolchainFingerprint">,
  architecture: string = process.arch,
): string =>
  [input.request.platform, architecture, input.toolchainFingerprint, input.nativeFingerprint].join(
    "-",
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
): string | null => {
  if (record.platform !== input.request.platform) return "platform"
  if (record.architecture !== architecture) return "architecture"
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
): NativeCacheRestore => ({
  hit: false,
  key: cacheKey,
  sourceBuildId: null,
  artifactHash: null,
  reason,
  artifacts,
  phases,
})

interface Service {
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
      const locations = (input: NativeCacheRequest) => {
        const artifact = nativeArtifact(input.request.platform)
        if (artifact === null) return null
        const cacheKey = nativeArtifactCacheKey(input)
        if (!isSafePathSegment(cacheKey)) throw new Error(`invalid native cache key: ${cacheKey}`)
        const directory = path.join(cacheRoot, cacheKey)
        return {
          cacheKey,
          directory,
          artifact: path.join(directory, artifact.name),
          platform: artifact.platform,
          record: path.join(directory, "record.json"),
        }
      }
      const restore: Service["restore"] = (input) =>
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
          const mismatch = nativeArtifactCacheMismatch(record, input)
          if (mismatch !== null) {
            return cacheMiss(location.cacheKey, `cache metadata mismatch: ${mismatch}`)
          }
          const actualHash = yield* products.hash(location.artifact)
          if (actualHash !== record.artifactHash) {
            return cacheMiss(location.cacheKey, "cached native artifact hash is invalid")
          }
          if (yield* fs.exists(input.output)) yield* fs.remove(input.output, { recursive: true })
          yield* fs.makeDirectory(path.dirname(input.output), { recursive: true })
          const repack = yield* commands
            .run(input.request, "build", "native-repack.ndjson", {
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
                NODE_ENV: "production",
                BETTER_NATIVE_MODE: input.request.mode,
                BETTER_NATIVE_BUILD_ID: input.request.id,
              },
              timeoutMillis: input.request.timeoutMillis,
            })
            .pipe(Effect.option)
          if (repack._tag === "None" || !(yield* fs.exists(input.output))) {
            if (yield* fs.exists(input.output)) yield* fs.remove(input.output, { recursive: true })
            return cacheMiss(location.cacheKey, "Expo repack failed; a full build is required")
          }
          return {
            hit: true,
            key: location.cacheKey,
            sourceBuildId: record.sourceBuildId,
            artifactHash: record.artifactHash,
            reason: "validated native artifact was repacked with the current JS bundle and assets",
            artifacts: [repack.value.artifact],
            phases: [repack.value.phase],
          }
        }).pipe(
          Effect.mapError(
            (cause) => new BuildPipelineError({ phase: "build", request: input.request, cause }),
          ),
        )
      const publish: Service["publish"] = (input) =>
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
          })
          yield* fs.writeFileString(
            path.join(temporary, "record.json"),
            `${JSON.stringify(encoded, null, 2)}\n`,
          )
          if (yield* fs.exists(location.directory))
            yield* fs.remove(location.directory, { recursive: true })
          yield* fs.makeDirectory(path.dirname(location.directory), { recursive: true })
          yield* fs.rename(temporary, location.directory)
          return {
            hit: false,
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
      return NativeArtifactCache.of({ restore, publish })
    }),
  )
