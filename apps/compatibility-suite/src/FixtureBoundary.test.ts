import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const FixtureManifest = Schema.Struct({ dependencies: Schema.Record(Schema.String, Schema.String) })

describe("compatibility fixture boundary", () => {
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
