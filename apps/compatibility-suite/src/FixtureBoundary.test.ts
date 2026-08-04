import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import config from "../app.config.ts"

const FixtureManifest = Schema.Struct({ dependencies: Schema.Record(Schema.String, Schema.String) })

describe("compatibility fixture boundary", () => {
  it("uses an isolated Expo identity with telemetry disabled at the app root", () => {
    assert.strictEqual(config.extra?.eas?.projectId, "00000000-0000-4000-8000-000000000000")
    const layout = readFileSync(
      fileURLToPath(new URL("../app/_layout.tsx", import.meta.url)),
      "utf8",
    )
    assert.include(layout, 'import { Observe } from "expo-observe"')
    assert.include(layout, "Observe.configure({ dispatchingEnabled: false })")
  })

  it.effect("keeps registry-only native packages outside the runner fixture", () =>
    Effect.gen(function* () {
      const manifest = yield* Schema.decodeUnknownEffect(FixtureManifest)(
        JSON.parse(
          readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
        ) as unknown,
      )

      assert.isDefined(manifest.dependencies["@better-native/metro"])
      assert.isDefined(manifest.dependencies.expo)
      assert.isDefined(manifest.dependencies["expo-router"])
      assert.isUndefined(manifest.dependencies["expo-analytics-amplitude"])
      assert.isUndefined(manifest.dependencies["@shopify/react-native-skia"])
      assert.isUndefined(manifest.dependencies["@sentry/react-native"])
    }),
  )
})
