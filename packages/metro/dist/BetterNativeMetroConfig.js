// src/BetterNativeMetroConfig.ts
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Schema from "effect/Schema";

class MetroConfigurationError extends Data.TaggedError("MetroConfigurationError") {
}

class ResolutionPolicy extends Context.Service()("@better-native/metro/ResolutionPolicy") {
}

class ResolutionObserver extends Context.Service()("@better-native/metro/ResolutionObserver") {
}
var Replacement = Schema.Struct({ source: Schema.String, target: Schema.String });
var ResolverInput = Schema.Struct({
  runId: Schema.NonEmptyString,
  buildId: Schema.NonEmptyString,
  ownershipFingerprint: Schema.NullOr(Schema.NonEmptyString),
  mode: Schema.Literals(["upstream", "candidate"]),
  replacements: Schema.Array(Replacement),
  upstreamNodeModulesPath: Schema.NonEmptyString,
  trackedSpecifiers: Schema.Array(Schema.String)
});
var configured = Symbol.for("@better-native/metro/configured");
var packageName = (specifier) => {
  if (specifier.length === 0 || specifier.startsWith(".") || specifier.startsWith("/"))
    return null;
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    return segments.length >= 2 && segments[0] !== "" && segments[1] !== "" ? `${segments[0]}/${segments[1]}` : null;
  }
  const first = segments[0];
  return first === undefined || first === "" ? null : first;
};
var validateSpecifier = (label, specifier) => {
  if (packageName(specifier) === null || specifier.includes("\\") || specifier.includes("\x00")) {
    throw new Error(`${label} must be a bare package specifier: ${JSON.stringify(specifier)}`);
  }
};
var makePolicy = (options) => Effect.try({
  try: () => {
    const decoded = Schema.decodeUnknownSync(ResolverInput)({
      runId: options.runId,
      buildId: options.buildId,
      ownershipFingerprint: options.ownershipFingerprint ?? null,
      mode: options.mode,
      replacements: options.replacements,
      upstreamNodeModulesPath: options.upstreamNodeModulesPath,
      trackedSpecifiers: options.trackedSpecifiers ?? options.replacements.map(({ source }) => source)
    });
    const replacements = new Map;
    for (const replacement of decoded.replacements) {
      validateSpecifier("replacement source", replacement.source);
      validateSpecifier("replacement target", replacement.target);
      if (replacements.has(replacement.source)) {
        throw new Error(`duplicate replacement source: ${replacement.source}`);
      }
      if (replacement.source === replacement.target) {
        throw new Error(`replacement source and target must differ: ${replacement.source}`);
      }
      replacements.set(replacement.source, replacement.target);
    }
    const tracked = new Set(decoded.trackedSpecifiers);
    for (const specifier of tracked)
      validateSpecifier("tracked specifier", specifier);
    return {
      runId: decoded.runId,
      buildId: decoded.buildId,
      ownershipFingerprint: decoded.ownershipFingerprint,
      mode: decoded.mode,
      upstreamNodeModulesPath: decoded.upstreamNodeModulesPath,
      resolve: Effect.fn("ResolutionPolicy.resolve")((request) => {
        const target = replacements.get(request.specifier);
        const selfUpstream = target !== undefined && request.originPackage !== null && request.originPackage === packageName(target);
        if (selfUpstream) {
          return Effect.succeed({
            decision: "self-upstream",
            requestedSpecifier: request.specifier,
            replacement: null
          });
        }
        if (request.mode === "candidate" && target !== undefined) {
          return Effect.succeed({
            decision: "candidate",
            requestedSpecifier: target,
            replacement: target
          });
        }
        if (!tracked.has(request.specifier)) {
          return Effect.succeed({
            decision: "unmanaged",
            requestedSpecifier: request.specifier,
            replacement: null
          });
        }
        return Effect.succeed({
          decision: "upstream",
          requestedSpecifier: request.specifier,
          replacement: null
        });
      })
    };
  },
  catch: (cause) => new MetroConfigurationError({ cause })
});
var policyLayer = (options) => Layer.effect(ResolutionPolicy)(makePolicy(options));
var observerLayer = (options) => Layer.effect(ResolutionObserver)(Effect.try({
  try: () => {
    if (options.onResolution !== undefined && typeof options.onResolution !== "function") {
      throw new Error("onResolution must be a function");
    }
    return {
      observe: Effect.fn("ResolutionObserver.observe")((event) => Effect.sync(() => options.onResolution?.(event)))
    };
  },
  catch: (cause) => new MetroConfigurationError({ cause })
}));
var layer = (options) => Layer.merge(policyLayer(options), observerLayer(options));
var originPackage = (context) => {
  try {
    return context.getPackageForModule(context.originModulePath)?.packageJson.name ?? null;
  } catch {
    return null;
  }
};
var conditions = (context, platform) => [
  ...context.unstable_conditionNames,
  ...platform === null ? [] : context.unstable_conditionsByPlatform[platform] ?? []
];
var environment = (context) => {
  const value2 = context.customResolverOptions.environment;
  return typeof value2 === "string" ? value2 : null;
};
var outcomeOf = (resolution) => {
  switch (resolution.type) {
    case "sourceFile":
      return { kind: "source-file", filePath: resolution.filePath.replaceAll("\\", "/") };
    case "assetFiles":
      return {
        kind: "asset-files",
        filePaths: resolution.filePaths.map((filePath) => filePath.replaceAll("\\", "/"))
      };
    case "empty":
      return { kind: "empty" };
    default:
      return { kind: "failure", name: "UnknownResolution", message: "Unknown Metro resolution" };
  }
};
var resolvedTargetOf = (outcome) => Match.value(outcome).pipe(Match.discriminatorsExhaustive("kind")({
  "source-file": ({ filePath }) => filePath,
  "asset-files": ({ filePaths }) => filePaths,
  empty: () => null,
  failure: () => null
}));
var resolvedPackageOf = (context, outcome) => {
  const target = Match.value(outcome).pipe(Match.discriminatorsExhaustive("kind")({
    "source-file": ({ filePath }) => filePath,
    "asset-files": ({ filePaths }) => filePaths[0],
    empty: () => {
      return;
    },
    failure: () => {
      return;
    }
  }));
  if (target === undefined)
    return null;
  try {
    return context.getPackageForModule(target)?.packageJson.name ?? null;
  } catch {
    return null;
  }
};
var failureOf = (cause) => cause instanceof Error ? { kind: "failure", name: cause.name, message: cause.message } : { kind: "failure", name: "UnknownError", message: String(cause) };
var makeEvent = (options) => ({
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
  resolvedPackage: resolvedPackageOf(options.context, options.outcome)
});
var observe = (observer, event) => Effect.runSync(observer.observe(event).pipe(Effect.catchCause((cause) => Effect.logError("Resolution observer failed", { cause }))));
var make = Effect.fn("BetterNativeMetroConfig.make")(function* (config) {
  if (config[configured] === true) {
    return yield* new MetroConfigurationError({
      cause: new Error("Metro config is already configured by @better-native/metro")
    });
  }
  const policy = yield* ResolutionPolicy;
  const observer = yield* ResolutionObserver;
  const previous = config.resolver.resolveRequest;
  const configMode = policy.mode;
  const resolveRequest = (context, specifier, platform) => {
    const directive = Effect.runSync(policy.resolve({
      mode: configMode,
      specifier,
      originPackage: originPackage(context)
    }));
    const next = previous ?? context.resolveRequest;
    const resolutionContext = directive.decision === "unmanaged" || directive.decision === "candidate" ? context : {
      ...context,
      nodeModulesPaths: [policy.upstreamNodeModulesPath, ...context.nodeModulesPaths]
    };
    let resolution;
    try {
      resolution = next(resolutionContext, directive.requestedSpecifier, platform);
    } catch (cause) {
      observe(observer, makeEvent({
        buildId: policy.buildId,
        ownershipFingerprint: policy.ownershipFingerprint,
        context,
        directive,
        mode: configMode,
        outcome: failureOf(cause),
        platform,
        runId: policy.runId,
        specifier
      }));
      throw cause;
    }
    observe(observer, makeEvent({
      buildId: policy.buildId,
      ownershipFingerprint: policy.ownershipFingerprint,
      context,
      directive,
      mode: configMode,
      outcome: outcomeOf(resolution),
      platform,
      runId: policy.runId,
      specifier
    }));
    return resolution;
  };
  return {
    ...config,
    [configured]: true,
    resolver: { ...config.resolver, resolveRequest }
  };
});
var configure = (config, options) => make(config).pipe(Effect.provide(layer(options)));
var withBetterNative = (config, options) => Effect.runSync(configure(config, options));
export {
  withBetterNative,
  make,
  layer,
  configure,
  ResolutionPolicy,
  ResolutionObserver,
  MetroConfigurationError
};
