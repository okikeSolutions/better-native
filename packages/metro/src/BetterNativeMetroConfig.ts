import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import type { MetroConfig } from "@expo/metro-config"

type MetroResolver = NonNullable<MetroConfig["resolver"]["resolveRequest"]>
type MetroResolutionContext = Parameters<MetroResolver>[0]
type MetroResolution = ReturnType<MetroResolver>

export type ResolutionMode = "upstream" | "candidate"
export type ResolutionDecision = "upstream" | "candidate" | "self-upstream" | "unmanaged"

export type ResolutionOutcome =
  | { readonly kind: "source-file"; readonly filePath: string }
  | { readonly kind: "asset-files"; readonly filePaths: ReadonlyArray<string> }
  | { readonly kind: "empty" }
  | { readonly kind: "failure"; readonly name: string; readonly message: string }

export interface ResolutionEvent {
  readonly runId: string
  readonly buildId: string
  readonly ownershipFingerprint: string | null
  readonly mode: ResolutionMode
  readonly specifier: string
  readonly replacement: string | null
  readonly decision: ResolutionDecision
  readonly originModulePath: string
  readonly originPackage: string | null
  readonly platform: string | null
  readonly environment: string | null
  readonly isEsmImport: boolean | null
  readonly conditions: ReadonlyArray<string>
  readonly mainFields: ReadonlyArray<string>
  readonly sourceExtensions: ReadonlyArray<string>
  readonly preferNativePlatform: boolean
  readonly outcome: ResolutionOutcome
  readonly resolvedTarget: string | ReadonlyArray<string> | null
  readonly resolvedPackage: string | null
}

export interface Replacement {
  readonly source: string
  readonly target: string
}

export interface BetterNativeMetroOptions {
  readonly runId: string
  readonly buildId: string
  readonly mode: ResolutionMode
  /** Fingerprint of the ownership policy that produced `replacements`. */
  readonly ownershipFingerprint?: string
  readonly replacements: ReadonlyArray<Replacement>
  /** node_modules produced from the exact pinned Expo worktree. */
  readonly upstreamNodeModulesPath: string
  readonly trackedSpecifiers?: ReadonlyArray<string>
  readonly onResolution?: (event: ResolutionEvent) => void
}

export interface ResolutionRequest {
  readonly mode: ResolutionMode
  readonly specifier: string
  readonly originPackage: string | null
}

export interface ResolutionDirective {
  readonly decision: ResolutionDecision
  readonly requestedSpecifier: string
  readonly replacement: string | null
}

export class MetroConfigurationError extends Data.TaggedError("MetroConfigurationError")<{
  readonly cause: unknown
}> {}

export class ResolutionPolicy extends Context.Service<
  ResolutionPolicy,
  {
    readonly resolve: (request: ResolutionRequest) => Effect.Effect<ResolutionDirective>
    readonly runId: string
    readonly buildId: string
    readonly ownershipFingerprint: string | null
    readonly mode: ResolutionMode
    readonly upstreamNodeModulesPath: string
  }
>()("@better-native/metro/ResolutionPolicy") {}

export class ResolutionObserver extends Context.Service<
  ResolutionObserver,
  {
    readonly observe: (event: ResolutionEvent) => Effect.Effect<void>
  }
>()("@better-native/metro/ResolutionObserver") {}

const Replacement = Schema.Struct({ source: Schema.String, target: Schema.String })
const ResolverInput = Schema.Struct({
  runId: Schema.NonEmptyString,
  buildId: Schema.NonEmptyString,
  ownershipFingerprint: Schema.NullOr(Schema.NonEmptyString),
  mode: Schema.Literals(["upstream", "candidate"]),
  replacements: Schema.Array(Replacement),
  upstreamNodeModulesPath: Schema.NonEmptyString,
  trackedSpecifiers: Schema.Array(Schema.String),
})

const configured = Symbol.for("@better-native/metro/configured")
type ConfiguredMetroConfig = MetroConfig & { readonly [configured]?: true }

const packageName = (specifier: string): string | null => {
  if (specifier.length === 0 || specifier.startsWith(".") || specifier.startsWith("/")) return null
  const segments = specifier.split("/")
  if (specifier.startsWith("@")) {
    return segments.length >= 2 && segments[0] !== "" && segments[1] !== ""
      ? `${segments[0]}/${segments[1]}`
      : null
  }
  const first = segments[0]
  return first === undefined || first === "" ? null : first
}

const validateSpecifier = (label: string, specifier: string): void => {
  if (packageName(specifier) === null || specifier.includes("\\") || specifier.includes("\0")) {
    throw new Error(`${label} must be a bare package specifier: ${JSON.stringify(specifier)}`)
  }
}

const makePolicy = (options: BetterNativeMetroOptions) =>
  Effect.try({
    try: () => {
      const decoded = Schema.decodeUnknownSync(ResolverInput)({
        runId: options.runId,
        buildId: options.buildId,
        ownershipFingerprint: options.ownershipFingerprint ?? null,
        mode: options.mode,
        replacements: options.replacements,
        upstreamNodeModulesPath: options.upstreamNodeModulesPath,
        trackedSpecifiers:
          options.trackedSpecifiers ?? options.replacements.map(({ source }) => source),
      })
      const replacements = new Map<string, string>()
      for (const replacement of decoded.replacements) {
        validateSpecifier("replacement source", replacement.source)
        validateSpecifier("replacement target", replacement.target)
        if (replacements.has(replacement.source)) {
          throw new Error(`duplicate replacement source: ${replacement.source}`)
        }
        if (replacement.source === replacement.target) {
          throw new Error(`replacement source and target must differ: ${replacement.source}`)
        }
        replacements.set(replacement.source, replacement.target)
      }
      const tracked = new Set(decoded.trackedSpecifiers)
      for (const specifier of tracked) validateSpecifier("tracked specifier", specifier)

      return {
        runId: decoded.runId,
        buildId: decoded.buildId,
        ownershipFingerprint: decoded.ownershipFingerprint,
        mode: decoded.mode,
        upstreamNodeModulesPath: decoded.upstreamNodeModulesPath,
        resolve: Effect.fn("ResolutionPolicy.resolve")(
          (request: ResolutionRequest): Effect.Effect<ResolutionDirective> => {
            const target = replacements.get(request.specifier)
            const selfUpstream =
              target !== undefined &&
              request.originPackage !== null &&
              request.originPackage === packageName(target)
            if (selfUpstream) {
              return Effect.succeed({
                decision: "self-upstream" as const,
                requestedSpecifier: request.specifier,
                replacement: null,
              })
            }
            if (request.mode === "candidate" && target !== undefined) {
              return Effect.succeed({
                decision: "candidate" as const,
                requestedSpecifier: target,
                replacement: target,
              })
            }
            if (!tracked.has(request.specifier)) {
              return Effect.succeed({
                decision: "unmanaged" as const,
                requestedSpecifier: request.specifier,
                replacement: null,
              })
            }
            return Effect.succeed({
              decision: "upstream" as const,
              requestedSpecifier: request.specifier,
              replacement: null,
            })
          },
        ),
      }
    },
    catch: (cause) => new MetroConfigurationError({ cause }),
  })

const policyLayer = (options: BetterNativeMetroOptions) =>
  Layer.effect(ResolutionPolicy)(makePolicy(options))

const observerLayer = (options: BetterNativeMetroOptions) =>
  Layer.effect(ResolutionObserver)(
    Effect.try({
      try: () => {
        if (options.onResolution !== undefined && typeof options.onResolution !== "function") {
          throw new Error("onResolution must be a function")
        }
        return {
          observe: Effect.fn("ResolutionObserver.observe")((event: ResolutionEvent) =>
            Effect.sync(() => options.onResolution?.(event)),
          ),
        }
      },
      catch: (cause) => new MetroConfigurationError({ cause }),
    }),
  )

export const layer = (
  options: BetterNativeMetroOptions,
): Layer.Layer<ResolutionPolicy | ResolutionObserver, MetroConfigurationError> =>
  Layer.merge(policyLayer(options), observerLayer(options))

const originPackage = (context: MetroResolutionContext): string | null => {
  try {
    return context.getPackageForModule(context.originModulePath)?.packageJson.name ?? null
  } catch {
    // Metro's virtual entry module is intentionally outside its file map and has no package.
    return null
  }
}

const conditions = (
  context: MetroResolutionContext,
  platform: string | null,
): ReadonlyArray<string> => [
  ...context.unstable_conditionNames,
  ...(platform === null ? [] : (context.unstable_conditionsByPlatform[platform] ?? [])),
]

const environment = (context: MetroResolutionContext): string | null => {
  const value = context.customResolverOptions.environment
  return typeof value === "string" ? value : null
}

const outcomeOf = (resolution: MetroResolution): ResolutionOutcome => {
  switch (resolution.type) {
    case "sourceFile":
      return { kind: "source-file", filePath: resolution.filePath.replaceAll("\\", "/") }
    case "assetFiles":
      return {
        kind: "asset-files",
        filePaths: resolution.filePaths.map((filePath) => filePath.replaceAll("\\", "/")),
      }
    case "empty":
      return { kind: "empty" }
    default:
      return { kind: "failure", name: "UnknownResolution", message: "Unknown Metro resolution" }
  }
}

const resolvedTargetOf = (outcome: ResolutionOutcome): string | ReadonlyArray<string> | null =>
  Match.value(outcome).pipe(
    Match.discriminatorsExhaustive("kind")({
      "source-file": ({ filePath }) => filePath,
      "asset-files": ({ filePaths }) => filePaths,
      empty: () => null,
      failure: () => null,
    }),
  )

const resolvedPackageOf = (
  context: MetroResolutionContext,
  outcome: ResolutionOutcome,
): string | null => {
  const target = Match.value(outcome).pipe(
    Match.discriminatorsExhaustive("kind")({
      "source-file": ({ filePath }) => filePath,
      "asset-files": ({ filePaths }) => filePaths[0],
      empty: () => undefined,
      failure: () => undefined,
    }),
  )
  if (target === undefined) return null
  try {
    return context.getPackageForModule(target)?.packageJson.name ?? null
  } catch {
    return null
  }
}

const failureOf = (cause: unknown): ResolutionOutcome =>
  cause instanceof Error
    ? { kind: "failure", name: cause.name, message: cause.message }
    : { kind: "failure", name: "UnknownError", message: String(cause) }

const makeEvent = (options: {
  readonly context: MetroResolutionContext
  readonly directive: ResolutionDirective
  readonly mode: ResolutionMode
  readonly outcome: ResolutionOutcome
  readonly platform: string | null
  readonly specifier: string
  readonly runId: string
  readonly buildId: string
  readonly ownershipFingerprint: string | null
}): ResolutionEvent => ({
  runId: options.runId,
  buildId: options.buildId,
  ownershipFingerprint: options.ownershipFingerprint,
  mode: options.mode,
  specifier: options.specifier,
  replacement: options.directive.replacement,
  decision: options.directive.decision,
  originModulePath: options.context.originModulePath.replaceAll("\\", "/"),
  originPackage: originPackage(options.context),
  platform: options.platform,
  environment: environment(options.context),
  isEsmImport: options.context.isESMImport ?? null,
  conditions: conditions(options.context, options.platform),
  mainFields: options.context.mainFields,
  sourceExtensions: options.context.sourceExts,
  preferNativePlatform: options.context.preferNativePlatform,
  outcome: options.outcome,
  resolvedTarget: resolvedTargetOf(options.outcome),
  resolvedPackage: resolvedPackageOf(options.context, options.outcome),
})

export const make: (
  config: MetroConfig,
) => Effect.Effect<MetroConfig, MetroConfigurationError, ResolutionPolicy | ResolutionObserver> =
  Effect.fn("BetterNativeMetroConfig.make")(function* (config: MetroConfig) {
    if ((config as ConfiguredMetroConfig)[configured] === true) {
      return yield* new MetroConfigurationError({
        cause: new Error("Metro config is already configured by @better-native/metro"),
      })
    }
    const policy = yield* ResolutionPolicy
    const observer = yield* ResolutionObserver
    const services = yield* Effect.context<ResolutionPolicy | ResolutionObserver>()
    const runSync = Effect.runSyncWith(services)
    const observe = (event: ResolutionEvent): void =>
      runSync(
        observer
          .observe(event)
          .pipe(
            Effect.catchCause((cause) => Effect.logError("Resolution observer failed", { cause })),
          ),
      )
    const previous = config.resolver.resolveRequest
    const configMode = policy.mode
    const resolveRequest: MetroResolver = (context, specifier, platform) => {
      const directive = runSync(
        policy.resolve({
          mode: configMode,
          specifier,
          originPackage: originPackage(context),
        }),
      )
      const next: MetroResolver = previous ?? context.resolveRequest
      // The pinned Expo worktree is the behavioral oracle. Candidate mode only
      // replaces explicitly migrated specifiers; every other tracked import is
      // resolved from the same pinned installation.
      const resolutionContext =
        directive.decision === "unmanaged" || directive.decision === "candidate"
          ? context
          : {
              ...context,
              nodeModulesPaths: [policy.upstreamNodeModulesPath, ...context.nodeModulesPaths],
            }
      let resolution: MetroResolution
      try {
        resolution = next(resolutionContext, directive.requestedSpecifier, platform)
      } catch (cause) {
        observe(
          makeEvent({
            buildId: policy.buildId,
            ownershipFingerprint: policy.ownershipFingerprint,
            context,
            directive,
            mode: configMode,
            outcome: failureOf(cause),
            platform,
            runId: policy.runId,
            specifier,
          }),
        )
        throw cause
      }
      observe(
        makeEvent({
          buildId: policy.buildId,
          ownershipFingerprint: policy.ownershipFingerprint,
          context,
          directive,
          mode: configMode,
          outcome: outcomeOf(resolution),
          platform,
          runId: policy.runId,
          specifier,
        }),
      )
      return resolution
    }
    return {
      ...config,
      [configured]: true,
      resolver: { ...config.resolver, resolveRequest },
    }
  })

export const configure = (
  config: MetroConfig,
  options: BetterNativeMetroOptions,
): Effect.Effect<MetroConfig, MetroConfigurationError> =>
  make(config).pipe(Effect.provide(layer(options)))

/** Synchronous Metro entrypoint. Effect programs stay behind this reviewed boundary. */
export const withBetterNative = (
  config: MetroConfig,
  options: BetterNativeMetroOptions,
): MetroConfig => Effect.runSync(configure(config, options))
