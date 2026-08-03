import Constants from "expo-constants"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { CompatibilityConfiguration } from "./Configuration.ts"

const ExpoExtra = Schema.Struct({
  betterNativeMode: Schema.Literals(["upstream", "candidate"]),
  betterNativeBuildId: Schema.NonEmptyString,
})

export const live = Layer.effect(
  CompatibilityConfiguration,
  Schema.decodeUnknownEffect(ExpoExtra)(Constants.expoConfig?.extra).pipe(
    Effect.map((extra) =>
      CompatibilityConfiguration.of({
        mode: extra.betterNativeMode,
        buildId: extra.betterNativeBuildId,
      }),
    ),
  ),
)
