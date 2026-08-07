import { assert, describe, it } from "@effect/vitest"
import type { MetroConfig } from "@expo/metro-config"
import * as Effect from "effect/Effect"
import {
  configure,
  MetroConfigurationError,
  withBetterNative,
  type ResolutionEvent,
} from "../src/BetterNativeMetroConfig.ts"

type Resolver = NonNullable<MetroConfig["resolver"]["resolveRequest"]>
type Context = Parameters<Resolver>[0]
type Resolution = ReturnType<Resolver>

const source = (filePath: string): Resolution => ({ type: "sourceFile", filePath })

const harness = (options?: {
  readonly mode?: "upstream" | "candidate"
  readonly originPackage?: string | null
  readonly resolution?: Resolution
  readonly failure?: Error
  readonly previousResolver?: boolean
  readonly replacements?: ReadonlyArray<{ readonly source: string; readonly target: string }>
  readonly environment?: unknown
  readonly isEsmImport?: boolean
  readonly conditionNames?: ReadonlyArray<string>
  readonly conditionsByPlatform?: Readonly<Record<string, ReadonlyArray<string>>>
  readonly originLookupFailure?: Error
}) => {
  const requests: Array<string> = []
  const nodeModulesPaths: Array<ReadonlyArray<string>> = []
  const events: Array<ResolutionEvent> = []
  const next: Resolver = (resolverContext, specifier) => {
    requests.push(specifier)
    nodeModulesPaths.push(resolverContext.nodeModulesPaths)
    if (options?.failure !== undefined) throw options.failure
    return options?.resolution ?? source(`/resolved/${specifier}.js`)
  }
  // The test supplies only the Metro fields consumed by the resolver. The real-context contract
  // is exercised separately by the Metro bundle integration test.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const context = {
    customResolverOptions: { environment: options?.environment ?? "client" },
    getPackageForModule: () => {
      if (options?.originLookupFailure !== undefined) throw options.originLookupFailure
      return options?.originPackage === null
        ? null
        : {
            packageJson: { name: options?.originPackage ?? "fixture-app" },
            rootPath: "/fixture",
            packageRelativePath: "index.js",
          }
    },
    isESMImport: options?.isEsmImport ?? true,
    mainFields: ["react-native", "browser", "main"],
    nodeModulesPaths: ["/fixture/node_modules"],
    originModulePath: "/fixture/index.js",
    preferNativePlatform: true,
    resolveRequest: next,
    sourceExts: ["ts", "tsx", "js"],
    unstable_conditionNames: options?.conditionNames ?? ["import"],
    unstable_conditionsByPlatform:
      options?.conditionsByPlatform ?? ({ ios: ["react-native"], web: ["browser"] } as const),
  } as unknown as Context
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const config = {
    resolver: { resolveRequest: options?.previousResolver === true ? next : undefined },
  } as MetroConfig
  const configured = withBetterNative(config, {
    buildId: "test-build",
    runId: "test-run",
    mode: options?.mode ?? "candidate",
    upstreamNodeModulesPath: "/pinned-expo/node_modules",
    replacements: options?.replacements ?? [
      { source: "expo-network", target: "@better-native/network/expo" },
    ],
    trackedSpecifiers: ["expo-network", "expo-constants"],
    onResolution: (event) => events.push(event),
  })
  const resolve = configured.resolver.resolveRequest
  if (resolve === undefined || resolve === null) throw new Error("resolver was not installed")
  return { context, events, nodeModulesPaths, requests, resolve }
}

describe("withBetterNative", () => {
  it("keeps upstream specifiers unchanged in upstream mode", () => {
    const test = harness({ mode: "upstream" })
    test.resolve(test.context, "expo-network", "ios")

    assert.deepEqual(test.requests, ["expo-network"])
    assert.deepEqual(test.nodeModulesPaths, [
      ["/pinned-expo/node_modules", "/fixture/node_modules"],
    ])
    assert.deepInclude(test.events[0], {
      mode: "upstream",
      specifier: "expo-network",
      replacement: null,
      decision: "upstream",
      platform: "ios",
      conditions: ["import", "react-native"],
    })
  })

  it("treats Metro virtual entries as package-less origins", () => {
    const test = harness({ originLookupFailure: new Error("Unexpectedly escaped traversal") })
    test.resolve(test.context, "expo-network", "web")

    assert.deepEqual(test.requests, ["@better-native/network/expo"])
    assert.strictEqual(test.events[0]?.originPackage, null)
  })

  it("replaces only an exact mapped specifier in candidate mode", () => {
    const test = harness()
    test.resolve(test.context, "expo-network", "web")
    test.resolve(test.context, "expo-networking", "web")
    test.resolve(test.context, "expo-constants", "web")

    assert.deepEqual(test.requests, [
      "@better-native/network/expo",
      "expo-networking",
      "expo-constants",
    ])
    assert.deepEqual(test.nodeModulesPaths[0], [
      "/pinned-expo/node_modules",
      "/fixture/node_modules",
    ])
    assert.deepEqual(test.nodeModulesPaths[2], [
      "/pinned-expo/node_modules",
      "/fixture/node_modules",
    ])
    assert.deepInclude(test.events[0], {
      mode: "candidate",
      specifier: "expo-network",
      replacement: "@better-native/network/expo",
      decision: "candidate",
    })
    assert.deepInclude(test.events[1], {
      specifier: "expo-networking",
      replacement: null,
      decision: "unmanaged",
    })
    assert.deepInclude(test.events[2], {
      specifier: "expo-constants",
      replacement: null,
      decision: "upstream",
    })
    assert.lengthOf(test.events, 3)
  })

  it("bypasses only the candidate package's self-import", () => {
    const test = harness({ originPackage: "@better-native/network" })
    test.resolve(test.context, "expo-network", "ios")

    assert.deepEqual(test.requests, ["expo-network"])
    assert.deepInclude(test.events[0], {
      replacement: null,
      decision: "self-upstream",
    })
  })

  it("preserves an existing resolver and passes it the selected specifier", () => {
    const test = harness({ previousResolver: true })
    test.resolve(test.context, "expo-network", "ios")

    assert.deepEqual(test.requests, ["@better-native/network/expo"])
  })

  it("records require, React Native and server resolution conditions", () => {
    const test = harness({
      environment: "node",
      isEsmImport: false,
      conditionNames: ["require", "react-server"],
      conditionsByPlatform: { ios: ["react-native"] },
    })
    test.resolve(test.context, "expo-network", "ios")

    assert.deepInclude(test.events[0], {
      environment: "node",
      isEsmImport: false,
      conditions: ["require", "react-server", "react-native"],
      mainFields: ["react-native", "browser", "main"],
      sourceExtensions: ["ts", "tsx", "js"],
      preferNativePlatform: true,
    })
  })

  it("normalizes a non-string custom environment", () => {
    const test = harness({ environment: 42 })
    test.resolve(test.context, "expo-network", "ios")

    assert.strictEqual(test.events[0]?.environment, null)
  })

  it("replaces a different capability imported by a candidate", () => {
    const test = harness({
      originPackage: "@better-native/network",
      replacements: [
        { source: "expo-network", target: "@better-native/network/expo" },
        { source: "expo-constants", target: "@better-native/constants/expo" },
      ],
    })
    test.resolve(test.context, "expo-constants", "android")

    assert.deepEqual(test.requests, ["@better-native/constants/expo"])
    assert.strictEqual(test.events[0]?.decision, "candidate")
  })

  it("records and rethrows the original resolver failure", () => {
    const failure = new Error("candidate is missing")
    const test = harness({ failure })

    try {
      test.resolve(test.context, "expo-network", "android")
      assert.fail("expected the resolver to throw")
    } catch (cause) {
      assert.strictEqual(cause, failure)
    }
    assert.deepEqual(test.events[0]?.outcome, {
      kind: "failure",
      name: "Error",
      message: "candidate is missing",
    })
  })

  it("does not let observer defects change Metro resolution", () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const config = { resolver: {} } as MetroConfig
    const configured = withBetterNative(config, {
      buildId: "observer-build",
      runId: "observer-run",
      mode: "candidate",
      upstreamNodeModulesPath: "/pinned-expo/node_modules",
      replacements: [{ source: "expo-network", target: "@better-native/network/expo" }],
      onResolution: () => {
        throw new Error("observer defect")
      },
    })
    const test = harness()
    const resolve = configured.resolver.resolveRequest
    if (resolve === undefined || resolve === null) throw new Error("resolver was not installed")

    assert.deepEqual(resolve(test.context, "expo-network", "ios"), {
      type: "sourceFile",
      filePath: "/resolved/@better-native/network/expo.js",
    })
  })

  it("preserves source, asset and empty Metro resolutions", () => {
    for (const resolution of [
      source("/fixture/source.js"),
      { type: "assetFiles", filePaths: ["/fixture/image.png"] } as const,
      { type: "empty" } as const,
    ]) {
      const test = harness({ resolution })
      assert.deepEqual(test.resolve(test.context, "expo-network", "web"), resolution)
    }
  })

  it("records an unknown resolution returned by a malformed resolver", () => {
    const malformed = { type: "unknown" } as unknown as Resolution
    const test = harness({ resolution: malformed })

    assert.strictEqual(test.resolve(test.context, "expo-network", "web"), malformed)
    assert.deepInclude(test.events[0], {
      outcome: {
        kind: "failure",
        name: "UnknownResolution",
        message: "Unknown Metro resolution",
      },
      resolvedTarget: null,
      resolvedPackage: null,
    })
  })

  it("rejects ambiguous configuration before Metro starts", () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const config = { resolver: {} } as MetroConfig
    assert.throws(() =>
      withBetterNative(config, {
        buildId: "invalid-build",
        runId: "invalid-run",
        mode: "candidate",
        upstreamNodeModulesPath: "/pinned-expo/node_modules",
        replacements: [
          { source: "expo-network", target: "@better-native/network/expo" },
          { source: "expo-network", target: "@better-native/network/other" },
        ],
      }),
    )
    assert.throws(() =>
      withBetterNative(config, {
        buildId: "recursive-build",
        runId: "recursive-run",
        mode: "candidate",
        upstreamNodeModulesPath: "/pinned-expo/node_modules",
        replacements: [{ source: "expo-network", target: "expo-network" }],
      }),
    )
    assert.throws(() =>
      withBetterNative(config, {
        buildId: "invalid-build",
        runId: "invalid-run",
        mode: "candidate",
        upstreamNodeModulesPath: "/pinned-expo/node_modules",
        replacements: [{ source: "../expo-network", target: "@better-native/network/expo" }],
      }),
    )
    assert.throws(() =>
      withBetterNative(config, {
        buildId: "invalid-observer-build",
        runId: "invalid-observer-run",
        mode: "candidate",
        upstreamNodeModulesPath: "/pinned-expo/node_modules",
        replacements: [],
        // Exercise the runtime boundary for untyped Metro configuration consumers.
        onResolution: "invalid" as never,
      }),
    )
    const configured = withBetterNative(config, {
      buildId: "configured-build",
      runId: "configured-run",
      mode: "upstream",
      upstreamNodeModulesPath: "/pinned-expo/node_modules",
      replacements: [],
    })
    assert.throws(() =>
      withBetterNative(configured, {
        buildId: "configured-build",
        runId: "configured-run",
        mode: "upstream",
        upstreamNodeModulesPath: "/pinned-expo/node_modules",
        replacements: [],
      }),
    )
  })

  it.effect("exposes configuration failures in the Effect error channel", () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const config = { resolver: {} } as MetroConfig
    return configure(config, {
      buildId: "effect-build",
      runId: "effect-run",
      mode: "candidate",
      upstreamNodeModulesPath: "/pinned-expo/node_modules",
      replacements: [{ source: "../expo-network", target: "@better-native/network/expo" }],
    }).pipe(
      Effect.flip,
      Effect.map((error) => assert.instanceOf(error, MetroConfigurationError)),
    )
  })
})
