import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { NativeRegistration } from "../Domain.ts"
import { HarnessError } from "../HarnessError.ts"

const NativeModule = Schema.Union([
  Schema.String,
  Schema.Struct({
    name: Schema.String,
    class: Schema.String,
  }),
])

const AppleConfig = Schema.Struct({
  modules: Schema.optional(Schema.Array(NativeModule)),
  appDelegateSubscribers: Schema.optional(Schema.Array(Schema.String)),
  reactDelegateHandlers: Schema.optional(Schema.Array(Schema.String)),
  podspecPath: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  swiftModuleName: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  debugOnly: Schema.optional(Schema.Boolean),
})

const AndroidProject = Schema.Struct({
  name: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  modules: Schema.optional(Schema.Array(NativeModule)),
  services: Schema.optional(Schema.Array(Schema.String)),
  publication: Schema.optional(Schema.Json),
  gradleAarProjects: Schema.optional(Schema.Array(Schema.Json)),
  shouldUsePublicationScriptPath: Schema.optional(Schema.String),
  gradlePath: Schema.optional(Schema.String),
})

const AndroidConfig = Schema.Struct({
  name: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  modules: Schema.optional(Schema.Array(NativeModule)),
  services: Schema.optional(Schema.Array(Schema.String)),
  projects: Schema.optional(Schema.Array(AndroidProject)),
  publication: Schema.optional(Schema.Json),
  gradlePlugins: Schema.optional(Schema.Array(Schema.Json)),
  gradleAarProjects: Schema.optional(Schema.Array(Schema.Json)),
  shouldUsePublicationScriptPath: Schema.optional(Schema.String),
  gradlePath: Schema.optional(Schema.String),
})

const DevtoolsConfig = Schema.Struct({
  webpageRoot: Schema.optional(Schema.String),
  bannerTitle: Schema.optional(Schema.Union([Schema.String, Schema.Boolean])),
  serverEntryPoint: Schema.optional(Schema.String),
  cliExtensions: Schema.optional(Schema.Json),
})

const RawConfig = Schema.Struct({
  name: Schema.optional(Schema.String),
  platforms: Schema.optional(Schema.Array(Schema.String)),
  apple: Schema.optional(AppleConfig),
  ios: Schema.optional(AppleConfig),
  android: Schema.optional(AndroidConfig),
  coreFeatures: Schema.optional(Schema.Array(Schema.String)),
  devtools: Schema.optional(DevtoolsConfig),
})

type NativeModule = Schema.Schema.Type<typeof NativeModule>
type RawConfig = Schema.Schema.Type<typeof RawConfig>

const moduleClass = (module: NativeModule): string =>
  typeof module === "string" ? module : module.class

const autolinkingPlatforms = (declared: ReadonlyArray<string>): ReadonlyArray<string> => {
  const configured = new Set(declared)
  const supportsApple = ["apple", "ios", "macos", "tvos"].some((platform) =>
    configured.has(platform),
  )
  const supported = new Set(declared)
  supported.add("web")
  if (supportsApple) {
    supported.add("apple")
    supported.add("ios")
    supported.add("macos")
    supported.add("tvos")
  }
  return [...supported].toSorted()
}

const normalize = (path: string, config: RawConfig, raw: Schema.Json): NativeRegistration => {
  const apple = config.apple ?? config.ios
  const androidProjects = [config.android, ...(config.android?.projects ?? [])].filter(
    (project): project is NonNullable<typeof project> => project !== undefined,
  )
  const declaredPlatforms = [...(config.platforms ?? [])].toSorted()
  return {
    kind: "config",
    path,
    declaredPlatforms,
    autolinkingPlatforms: autolinkingPlatforms(declaredPlatforms),
    appleModules: (apple?.modules ?? []).map(moduleClass).toSorted(),
    androidModules: androidProjects
      .flatMap((project) => project.modules ?? [])
      .map(moduleClass)
      .toSorted(),
    appDelegateSubscribers: [...(apple?.appDelegateSubscribers ?? [])].toSorted(),
    reactDelegateHandlers: [...(apple?.reactDelegateHandlers ?? [])].toSorted(),
    androidServices: androidProjects.flatMap((project) => project.services ?? []).toSorted(),
    coreFeatures: [...(config.coreFeatures ?? [])].toSorted(),
    devtoolsServerEntryPoint: config.devtools?.serverEntryPoint ?? null,
    raw,
  }
}

/**
 * Decodes Expo module configuration into normalized native-registration evidence.
 *
 * @remarks
 * Raw configuration is retained alongside normalized module and platform lists
 * so catalog decisions remain auditable against the source checkout.
 *
 * @param path - Configuration path relative to the Expo checkout.
 * @param text - Raw JSON configuration text.
 * @returns Normalized registration metadata, or `null` when no native registration exists.
 */
export const decode = (
  path: string,
  text: string,
): Effect.Effect<NativeRegistration, HarnessError> => {
  const parse = Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => new HarnessError({ operation: "parse native registration", path, cause }),
  })

  return Effect.matchEffect(parse, {
    onFailure: (cause) =>
      text.includes("<%") ? Effect.succeed({ kind: "template", path }) : Effect.fail(cause),
    onSuccess: (value) =>
      Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
        Effect.flatMap((raw) =>
          Schema.decodeUnknownEffect(RawConfig)(raw).pipe(
            Effect.map((config) => normalize(path, config, raw)),
          ),
        ),
        Effect.mapError(
          (cause) => new HarnessError({ operation: "decode native registration", path, cause }),
        ),
      ),
  })
}
