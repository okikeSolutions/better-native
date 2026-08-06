import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { HarnessConfig, layer } from "./HarnessConfig.ts"
import { provideLayer } from "./TestLayers.ts"

const configuredLayer = (env: Record<string, string>) =>
  layer("/workspace/project").pipe(
    Layer.provide(
      Layer.merge(NodeServices.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    ),
  )

describe("HarnessConfig", () => {
  it.effect("provides deterministic defaults", () =>
    Effect.gen(function* () {
      const config = yield* HarnessConfig
      assert.strictEqual(config.expoSourceRoot, "/workspace/expo")
      assert.strictEqual(config.githubSha, null)
      assert.strictEqual(config.forceColdBuild, false)
      assert.strictEqual(config.iosDestination, "generic/platform=iOS Simulator")
      assert.strictEqual(config.caches.pnpmStore.status, "unknown")
      assert.isTrue(Option.isNone(config.turboToken))
    }).pipe(provideLayer(configuredLayer({ TURBO_TOKEN: "   ", TURBO_TEAM: "   " }))),
  )

  it.effect("parses typed build, cache, and secret configuration", () =>
    Effect.gen(function* () {
      const config = yield* HarnessConfig
      assert.strictEqual(config.expoSourceRoot, "/sources/expo")
      assert.strictEqual(config.githubSha, "abc123")
      assert.strictEqual(config.forceColdBuild, true)
      assert.strictEqual(config.ccacheEnabled, true)
      assert.strictEqual(config.caches.pnpmStore.status, "hit")
      assert.strictEqual(config.caches.ccache.status, "miss")
      assert.strictEqual(config.caches.gradle.key, "gradle-key")
      assert.strictEqual(config.caches.pods.status, "hit")
      assert.strictEqual(config.turboTeam, "team")
      assert.strictEqual(Redacted.value(Option.getOrThrow(config.turboToken)), "secret")
    }).pipe(
      provideLayer(
        configuredLayer({
          EXPO_SOURCE_ROOT: "/sources/expo",
          GITHUB_SHA: "abc123",
          TURBO_TOKEN: "secret",
          TURBO_TEAM: "team",
          CCACHE_DIR: "/cache/ccache",
          BETTER_NATIVE_FORCE_COLD_BUILD: "1",
          BETTER_NATIVE_PNPM_STORE_CACHE_HIT: "true",
          BETTER_NATIVE_CCACHE_CACHE_HIT: "false",
          BETTER_NATIVE_GRADLE_CACHE_KEY: "gradle-key",
          BETTER_NATIVE_PODS_CACHE_HIT: "yes",
        }),
      ),
    ),
  )

  it.effect("rejects malformed boolean configuration", () =>
    HarnessConfig.pipe(
      provideLayer(configuredLayer({ BETTER_NATIVE_FORCE_COLD_BUILD: "sometimes" })),
      Effect.flip,
      Effect.map((error) => assert.include(String(error), "BETTER_NATIVE_FORCE_COLD_BUILD")),
    ),
  )
})
