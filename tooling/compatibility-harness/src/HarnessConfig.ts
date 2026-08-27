import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Redacted from "effect/Redacted"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import type { BuildProfile } from "./build/BuildProfile.ts"

/** Environment variable names owned by the host-side harness configuration. */
export const environmentKeys = {
  expoSourceRoot: "EXPO_SOURCE_ROOT",
  ci: "CI",
  buildProfile: "BETTER_NATIVE_BUILD_PROFILE",
  githubSha: "GITHUB_SHA",
  turboToken: "TURBO_TOKEN",
  turboTeam: "TURBO_TEAM",
  ccacheDirectory: "CCACHE_DIR",
  javaHome17: "BETTER_NATIVE_JAVA_HOME_17",
  androidSdkRoot: "ANDROID_SDK_ROOT",
  androidHome: "ANDROID_HOME",
  iosDestination: "BETTER_NATIVE_IOS_DESTINATION",
  iosDevelopmentTeam: "BETTER_NATIVE_IOS_DEVELOPMENT_TEAM",
  iosCodeSignIdentity: "BETTER_NATIVE_IOS_CODE_SIGN_IDENTITY",
  forceColdBuild: "BETTER_NATIVE_FORCE_COLD_BUILD",
  pnpmStoreCacheHit: "BETTER_NATIVE_PNPM_STORE_CACHE_HIT",
  pnpmStoreCacheKey: "BETTER_NATIVE_PNPM_STORE_CACHE_KEY",
  ccacheCacheHit: "BETTER_NATIVE_CCACHE_CACHE_HIT",
  ccacheCacheKey: "BETTER_NATIVE_CCACHE_CACHE_KEY",
  gradleCacheKey: "BETTER_NATIVE_GRADLE_CACHE_KEY",
  podsCacheHit: "BETTER_NATIVE_PODS_CACHE_HIT",
  podsCacheKey: "BETTER_NATIVE_PODS_CACHE_KEY",
} as const

/** Cache status and opaque key recorded as build evidence. */
export interface CacheEnvironment {
  readonly status: "hit" | "miss" | "unknown"
  readonly key: string | null
}

/** Validated host configuration shared by harness services. */
export interface Service {
  readonly expoSourceRoot: string
  readonly githubSha: string | null
  readonly turboToken: Option.Option<Redacted.Redacted>
  readonly turboTeam: string | null
  readonly ccacheEnabled: boolean
  readonly javaHome17: string | null
  readonly executablePath: string
  readonly androidSdkRoot: string | null
  readonly iosDestination: string
  readonly iosDevelopmentTeam: string | null
  readonly iosCodeSignIdentity: string
  readonly forceColdBuild: boolean
  readonly buildProfile: BuildProfile
  readonly caches: {
    readonly pnpmStore: CacheEnvironment
    readonly ccache: CacheEnvironment
    readonly gradle: CacheEnvironment
    readonly pods: CacheEnvironment
  }
}

/** Effect context tag for the single host environment boundary. */
export class HarnessConfig extends Context.Service<HarnessConfig, Service>()(
  "@better-native/compatibility-harness/HarnessConfig",
) {}

const optionalString = (name: string) =>
  Config.string(name).pipe(
    Config.option,
    Config.map(
      Option.flatMap((value) => {
        const trimmed = value.trim()
        return trimmed.length === 0 ? Option.none() : Option.some(trimmed)
      }),
    ),
  )

const optionalRedacted = (name: string) =>
  Config.redacted(name).pipe(
    Config.option,
    Config.map(
      Option.flatMap((value) => {
        const trimmed = Redacted.value(value).trim()
        return trimmed.length === 0 ? Option.none() : Option.some(Redacted.make(trimmed))
      }),
    ),
  )

const nullable = <A>(value: Option.Option<A>): A | null => Option.getOrNull(value)

const isJava17Home = (home: string): boolean => {
  try {
    return (
      existsSync(`${home}/bin/java`) &&
      /JAVA_VERSION="17[."]/.test(readFileSync(`${home}/release`, "utf8"))
    )
  } catch {
    return false
  }
}

/** Resolves a verified JDK 17 independently from the caller's default Java. */
export const resolveJava17Home = (explicit: string | null): string | null => {
  if (explicit !== null && isJava17Home(explicit)) return explicit
  if (process.platform !== "darwin") return null
  const conventional = [
    "/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home",
    "/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home",
    "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
  ].find(isJava17Home)
  if (conventional !== undefined) return conventional
  try {
    const discovered = execFileSync("/usr/libexec/java_home", ["-v", "17"], {
      encoding: "utf8",
    }).trim()
    return isJava17Home(discovered) ? discovered : null
  } catch {
    return null
  }
}

const cacheStatus = (value: Option.Option<boolean>): CacheEnvironment["status"] =>
  Option.match(value, {
    onNone: () => "unknown",
    onSome: (hit) =>
      Match.value(hit).pipe(
        Match.when(true, () => "hit" as const),
        Match.when(false, () => "miss" as const),
        Match.exhaustive,
      ),
  })

/**
 * Loads harness configuration from the environment.
 *
 * @remarks
 * Optional strings are trimmed, secrets remain redacted, and the Expo source
 * defaults beside the repository. Services consume this layer instead of reading
 * `process.env` directly.
 *
 * @param root - Better Native repository root used to derive defaults.
 * @returns A layer providing validated {@link HarnessConfig} values.
 */
export const layer = (root: string) =>
  Layer.effect(
    HarnessConfig,
    Effect.gen(function* () {
      const path = yield* Path.Path
      const values = yield* Config.all({
        expoSourceRoot: Config.string(environmentKeys.expoSourceRoot).pipe(
          Config.withDefault(path.join(root, "..", "expo")),
        ),
        ci: Config.boolean(environmentKeys.ci).pipe(Config.withDefault(false)),
        buildProfile: Config.literals(["polite", "performance"], environmentKeys.buildProfile).pipe(
          Config.option,
        ),
        githubSha: optionalString(environmentKeys.githubSha),
        turboToken: optionalRedacted(environmentKeys.turboToken),
        turboTeam: optionalString(environmentKeys.turboTeam),
        ccacheDirectory: optionalString(environmentKeys.ccacheDirectory),
        javaHome17: optionalString(environmentKeys.javaHome17),
        executablePath: Config.string("PATH").pipe(Config.withDefault("")),
        androidSdkRoot: optionalString(environmentKeys.androidSdkRoot),
        androidHome: optionalString(environmentKeys.androidHome),
        iosDestination: Config.string(environmentKeys.iosDestination).pipe(
          Config.withDefault("generic/platform=iOS Simulator"),
        ),
        iosDevelopmentTeam: optionalString(environmentKeys.iosDevelopmentTeam),
        iosCodeSignIdentity: Config.string(environmentKeys.iosCodeSignIdentity).pipe(
          Config.withDefault("Apple Development"),
        ),
        forceColdBuild: Config.boolean(environmentKeys.forceColdBuild).pipe(
          Config.withDefault(false),
        ),
        pnpmStoreCacheHit: Config.boolean(environmentKeys.pnpmStoreCacheHit).pipe(Config.option),
        pnpmStoreCacheKey: optionalString(environmentKeys.pnpmStoreCacheKey),
        ccacheCacheHit: Config.boolean(environmentKeys.ccacheCacheHit).pipe(Config.option),
        ccacheCacheKey: optionalString(environmentKeys.ccacheCacheKey),
        gradleCacheKey: optionalString(environmentKeys.gradleCacheKey),
        podsCacheHit: Config.boolean(environmentKeys.podsCacheHit).pipe(Config.option),
        podsCacheKey: optionalString(environmentKeys.podsCacheKey),
      })
      return HarnessConfig.of({
        expoSourceRoot: values.expoSourceRoot,
        githubSha: nullable(values.githubSha),
        turboToken: values.turboToken,
        turboTeam: nullable(values.turboTeam),
        ccacheEnabled: Option.isSome(values.ccacheDirectory),
        javaHome17: resolveJava17Home(nullable(values.javaHome17)),
        executablePath: values.executablePath,
        androidSdkRoot: nullable(values.androidSdkRoot) ?? nullable(values.androidHome),
        iosDestination: values.iosDestination,
        iosDevelopmentTeam: nullable(values.iosDevelopmentTeam),
        iosCodeSignIdentity: values.iosCodeSignIdentity,
        forceColdBuild: values.forceColdBuild,
        buildProfile: Option.getOrElse(values.buildProfile, () =>
          values.ci ? "performance" : "polite",
        ),
        caches: {
          pnpmStore: {
            status: cacheStatus(values.pnpmStoreCacheHit),
            key: nullable(values.pnpmStoreCacheKey),
          },
          ccache: {
            status: cacheStatus(values.ccacheCacheHit),
            key: nullable(values.ccacheCacheKey),
          },
          gradle: {
            status: "unknown",
            key: nullable(values.gradleCacheKey),
          },
          pods: {
            status: cacheStatus(values.podsCacheHit),
            key: nullable(values.podsCacheKey),
          },
        },
      })
    }),
  )
