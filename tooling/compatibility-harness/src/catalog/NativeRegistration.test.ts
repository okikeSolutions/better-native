import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as NativeRegistration from "./NativeRegistration.ts"

const PlatformConfig = Schema.Struct({
  platforms: Schema.Array(Schema.String),
})

describe("NativeRegistration", () => {
  it.effect("decodes and normalizes native registration metadata", () =>
    Effect.gen(function* () {
      const registration = yield* NativeRegistration.decode(
        "expo-module.config.json",
        JSON.stringify({
          platforms: ["apple", "android"],
          apple: {
            modules: ["NetworkModule"],
            appDelegateSubscribers: ["NetworkSubscriber"],
          },
          android: {
            modules: ["expo.modules.network.NetworkModule"],
            services: ["expo.modules.network.NetworkService"],
          },
        }),
      )

      assert.strictEqual(registration.kind, "config")
      if (registration.kind === "config") {
        assert.deepEqual(registration.autolinkingPlatforms, [
          "android",
          "apple",
          "ios",
          "macos",
          "tvos",
          "web",
        ])
        assert.deepEqual(registration.appleModules, ["NetworkModule"])
        assert.deepEqual(registration.androidModules, ["expo.modules.network.NetworkModule"])
      }
    }),
  )

  it.effect.prop(
    "preserves every declared platform",
    [PlatformConfig],
    ([input]) =>
      Effect.gen(function* () {
        const registration = yield* NativeRegistration.decode(
          "expo-module.config.json",
          JSON.stringify(input),
        )
        assert.strictEqual(registration.kind, "config")
        if (registration.kind === "config") {
          for (const platform of input.platforms) {
            assert.include(registration.declaredPlatforms, platform)
            assert.include(registration.autolinkingPlatforms, platform)
          }
        }
      }),
    { fastCheck: { numRuns: 100 } },
  )

  it.effect("accounts for generator templates without parsing them as JSON", () =>
    Effect.gen(function* () {
      const registration = yield* NativeRegistration.decode(
        "expo-module.config.json",
        '{ "platforms": [<%- project.platforms %>] }',
      )
      assert.deepEqual(registration, {
        kind: "template",
        path: "expo-module.config.json",
      })
    }),
  )
})
