import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import { ArtifactId, BuildId, ContentHash } from "../Domain.ts"
import { provideLayer } from "../TestLayers.ts"
import * as HarnessConfig from "../HarnessConfig.ts"
import { BuildCommand } from "./BuildCommand.ts"
import { BuildPipelineError, type BuildRequest } from "./BuildModel.ts"
import { layer as buildProductsLayer } from "./BuildProducts.ts"
import {
  NativeArtifactCache,
  nativeArtifactCacheKey,
  nativeArtifactCacheMismatch,
  nativeArtifactName,
  layer,
  type NativeArtifactCacheRecord,
  type NativeCacheRequest,
} from "./NativeArtifactCache.ts"

const hash = (character: string) => ContentHash.make(character.repeat(64))
const request: BuildRequest = {
  id: BuildId.make("cache-test"),
  mode: "upstream",
  platform: "android",
  expoRevision: "1".repeat(40),
  candidateRevision: null,
  timeoutMillis: 1_000,
}
const input = (root: string): NativeCacheRequest => ({
  request,
  appDirectory: `${root}/app`,
  output: `${root}/output.apk`,
  nativeFingerprint: "native-inputs",
  toolchainFingerprint: hash("2"),
})
const record: NativeArtifactCacheRecord = {
  schemaVersion: 1,
  platform: "android",
  architecture: "test-architecture",
  expoRevision: request.expoRevision,
  nativeFingerprint: "native-inputs",
  toolchainFingerprint: hash("2"),
  sourceBuildId: BuildId.make("source-build"),
  artifactHash: hash("3"),
}

const harnessConfig = HarnessConfig.layer(process.cwd()).pipe(Layer.provide(NodeServices.layer))

const fakeCommands = Layer.succeed(
  BuildCommand,
  BuildCommand.of({
    persistObservations: () => Effect.die("unexpected evidence write"),
    run: (buildRequest) =>
      Effect.fail(
        new BuildPipelineError({
          phase: "build",
          request: buildRequest,
          cause: "fixture has no JS bundle",
        }),
      ),
  }),
)

const successfulCommands = Layer.effect(
  BuildCommand,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return BuildCommand.of({
      persistObservations: () => Effect.die("unexpected evidence write"),
      run: (buildRequest, phase, _name, spec) =>
        Effect.gen(function* () {
          const sourceIndex = spec.args?.indexOf("--source-app") ?? -1
          const outputIndex = spec.args?.indexOf("--output") ?? -1
          if (sourceIndex < 0 || outputIndex < 0 || spec.args === undefined) {
            return yield* new BuildPipelineError({
              phase,
              request: buildRequest,
              cause: "missing repack paths",
            })
          }
          yield* fs
            .copy(spec.args[sourceIndex + 1]!, spec.args[outputIndex + 1]!)
            .pipe(
              Effect.mapError(
                (cause) => new BuildPipelineError({ phase, request: buildRequest, cause }),
              ),
            )
          return {
            result: { exitCode: 0, signal: null, observations: [] },
            artifact: {
              id: ArtifactId.make("repack-evidence"),
              path: "repack.ndjson",
              mediaType: "application/x-ndjson",
              size: 0,
              hash: hash("9"),
            },
            phase: {
              name: "native-repack.ndjson",
              startedAtMillis: 0,
              finishedAtMillis: 1,
              durationMillis: 1,
            },
          }
        }),
    })
  }),
)

describe("NativeArtifactCache", () => {
  it("uses explicit artifact names only for native platforms", () => {
    assert.strictEqual(nativeArtifactName("ios"), "BetterNativeCompatibility.app")
    assert.strictEqual(nativeArtifactName("android"), "app-release.apk")
    assert.isNull(nativeArtifactName("web"))
  })

  it("keys native inputs independently of run identity and mode", () => {
    const upstream = input("/tmp/upstream")
    const candidate: NativeCacheRequest = {
      ...upstream,
      request: {
        ...upstream.request,
        id: BuildId.make("another-run-id"),
        mode: "candidate",
        candidateRevision: "candidate-revision",
      },
    }
    assert.strictEqual(
      nativeArtifactCacheKey(upstream, "test-architecture"),
      nativeArtifactCacheKey(candidate, "test-architecture"),
    )
    assert.notStrictEqual(
      nativeArtifactCacheKey(upstream, "test-architecture"),
      nativeArtifactCacheKey(
        { ...upstream, nativeFingerprint: "changed-native-inputs" },
        "test-architecture",
      ),
    )
  })

  it("rejects stale fingerprints and wrong compiler toolchains", () => {
    const current = input("/tmp/cache")
    assert.isNull(nativeArtifactCacheMismatch(record, current, "test-architecture"))
    assert.strictEqual(
      nativeArtifactCacheMismatch(
        { ...record, nativeFingerprint: "stale" },
        current,
        "test-architecture",
      ),
      "native-fingerprint",
    )
    assert.strictEqual(
      nativeArtifactCacheMismatch(
        { ...record, toolchainFingerprint: hash("4") },
        current,
        "test-architecture",
      ),
      "toolchain-fingerprint",
    )
    assert.strictEqual(
      nativeArtifactCacheMismatch(record, current, "wrong-architecture"),
      "architecture",
    )
  })

  it.effect("treats a tampered cached binary as a miss before repacking", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-cache-" })
      yield* fs.makeDirectory(`${root}/app`, { recursive: true })
      yield* fs.writeFileString(`${root}/output.apk`, "original")
      const current = input(root)
      const restored = yield* Effect.gen(function* () {
        const cache = yield* NativeArtifactCache
        const published = yield* cache.publish(current)
        const entry = `${root}/.artifacts/native-cache/v1/${published.key}`
        yield* fs.writeFileString(`${entry}/app-release.apk`, "tampered")
        return yield* cache.restore(current)
      }).pipe(
        provideLayer(
          layer(root).pipe(
            Layer.provideMerge(Layer.mergeAll(fakeCommands, buildProductsLayer, harnessConfig)),
          ),
        ),
      )
      assert.isFalse(restored.hit)
      assert.match(restored.reason, /hash is invalid/)
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("falls back for malformed metadata, missing artifacts, and repack failures", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-cache-faults-" })
      yield* fs.makeDirectory(`${root}/app`, { recursive: true })
      yield* fs.writeFileString(`${root}/output.apk`, "original")
      const current = input(root)
      const results = yield* Effect.gen(function* () {
        const cache = yield* NativeArtifactCache
        const first = yield* cache.publish(current)
        const entry = `${root}/.artifacts/native-cache/v1/${first.key}`
        yield* fs.writeFileString(`${entry}/record.json`, "{}")
        const malformed = yield* cache.restore(current)

        yield* cache.publish(current)
        yield* fs.remove(`${entry}/app-release.apk`)
        const missing = yield* cache.restore(current)

        yield* cache.publish(current)
        const repackFailure = yield* cache.restore(current)
        return { malformed, missing, repackFailure }
      }).pipe(
        provideLayer(
          layer(root).pipe(
            Layer.provideMerge(Layer.mergeAll(fakeCommands, buildProductsLayer, harnessConfig)),
          ),
        ),
      )
      assert.match(results.malformed.reason, /metadata is malformed/)
      assert.match(results.missing.reason, /entry is missing/)
      assert.match(results.repackFailure.reason, /repack failed/)
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("reuses one validated shell across upstream and candidate modes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-cache-pair-" })
      yield* fs.makeDirectory(`${root}/app`, { recursive: true })
      yield* fs.writeFileString(`${root}/output.apk`, "upstream-shell")
      const upstream = input(root)
      const candidate: NativeCacheRequest = {
        ...upstream,
        request: {
          ...upstream.request,
          id: BuildId.make("candidate-build"),
          mode: "candidate",
          candidateRevision: "candidate-revision",
        },
        output: `${root}/candidate.apk`,
      }
      const restored = yield* Effect.gen(function* () {
        const cache = yield* NativeArtifactCache
        yield* cache.publish(upstream)
        return yield* cache.restore(candidate)
      }).pipe(
        provideLayer(
          layer(root).pipe(
            Layer.provideMerge(
              Layer.mergeAll(successfulCommands, buildProductsLayer, harnessConfig),
            ),
          ),
        ),
      )
      assert.isTrue(restored.hit)
      assert.strictEqual(restored.sourceBuildId, BuildId.make("cache-test"))
      assert.strictEqual(yield* fs.readFileString(candidate.output), "upstream-shell")
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )
})
