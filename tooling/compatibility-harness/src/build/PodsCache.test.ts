import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import { BuildId, ContentHash } from "../Domain.ts"
import { provideLayer } from "../TestLayers.ts"
import type { BuildRequest } from "./BuildModel.ts"
import { layer as buildProductsLayer } from "./BuildProducts.ts"
import { PodsCache, layer } from "./PodsCache.ts"

const request = (id: string, mode: "upstream" | "candidate"): BuildRequest => ({
  id: BuildId.make(id),
  mode,
  platform: "ios",
  expoRevision: "1".repeat(40),
  candidateRevision: mode === "candidate" ? "candidate" : null,
  timeoutMillis: 1_000,
})

const cacheLayer = (root: string) => layer(root).pipe(Layer.provideMerge(buildProductsLayer))

describe("PodsCache", () => {
  it.effect("deduplicates modes by effective inputs and the resulting Podfile.lock", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-pods-cache-" })
      const upstreamRoot = `${root}/.artifacts/workspaces/ios-upstream`
      const candidateRoot = `${root}/.artifacts/workspaces/ios-candidate`
      const prepare = (workspace: string) =>
        Effect.gen(function* () {
          const ios = `${workspace}/ios`
          yield* fs.makeDirectory(`${ios}/Pods`, { recursive: true })
          yield* fs.writeFileString(`${ios}/Podfile`, `source '${workspace}/native-node-modules'\n`)
          yield* fs.writeFileString(`${ios}/Podfile.properties.json`, "{}\n")
          yield* fs.writeFileString(`${ios}/Podfile.lock`, "PODS:\n  - Expo (1.0)\n")
          yield* fs.writeFileString(`${ios}/Pods/Manifest.lock`, "PODS:\n  - Expo (1.0)\n")
          return ios
        })
      const upstreamIos = yield* prepare(upstreamRoot)
      const candidateIos = yield* prepare(candidateRoot)
      yield* Effect.gen(function* () {
        const cache = yield* PodsCache
        const published = yield* cache.publish({
          request: request("upstream", "upstream"),
          iosDirectory: upstreamIos,
          workspaceRoot: upstreamRoot,
          architecture: "arm64",
          toolchainFingerprint: ContentHash.make("2".repeat(64)),
        })
        yield* fs.remove(`${candidateIos}/Pods`, { recursive: true })
        yield* fs.remove(`${candidateIos}/Podfile.lock`)
        const restored = yield* cache.restore({
          request: request("candidate", "candidate"),
          iosDirectory: candidateIos,
          workspaceRoot: candidateRoot,
          architecture: "arm64",
          toolchainFingerprint: ContentHash.make("2".repeat(64)),
        })
        assert.isTrue(restored.hit)
        assert.strictEqual(restored.key, published.key)
      }).pipe(provideLayer(cacheLayer(root)))
      assert.lengthOf(yield* fs.readDirectory(`${root}/.artifacts/pods-cache/v2/entries`), 1)
      assert.strictEqual(
        yield* fs.readFileString(`${candidateIos}/Podfile.lock`),
        "PODS:\n  - Expo (1.0)\n",
      )
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("does not publish while another process owns the cache lock", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-pods-lock-" })
      const workspace = `${root}/.artifacts/workspaces/ios-upstream`
      const ios = `${workspace}/ios`
      yield* fs.makeDirectory(`${ios}/Pods`, { recursive: true })
      yield* fs.writeFileString(`${ios}/Podfile`, "platform :ios, '15.1'\n")
      yield* fs.writeFileString(`${ios}/Podfile.properties.json`, "{}\n")
      yield* fs.writeFileString(`${ios}/Podfile.lock`, "PODS:\n  - Expo (1.0)\n")
      const cacheParent = `${root}/.artifacts/pods-cache`
      yield* fs.makeDirectory(cacheParent, { recursive: true })
      yield* fs.writeFileString(`${cacheParent}/v2.lock`, "other-owner")

      const result = yield* Effect.gen(function* () {
        const cache = yield* PodsCache
        return yield* cache.publish({
          request: request("upstream", "upstream"),
          iosDirectory: ios,
          workspaceRoot: workspace,
          architecture: "arm64",
          toolchainFingerprint: ContentHash.make("2".repeat(64)),
        })
      }).pipe(provideLayer(cacheLayer(root)))

      assert.isFalse(result.hit)
      assert.strictEqual(result.key, "busy")
      assert.match(result.detail, /publication skipped/)
      assert.isFalse(yield* fs.exists(`${cacheParent}/v2`))
      assert.strictEqual(yield* fs.readFileString(`${cacheParent}/v2.lock`), "other-owner")
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )
})
