import { readFileSync } from "node:fs"
import { DiagnosticLimits, makeDiagnostic } from "@effect-expo/core/Diagnostic"
import { describe, expect, it } from "vitest"
import { checkPolicySource, renderDiagnostics } from "../src/PolicyCheck.ts"

const codes = (file: string, source: string) =>
  checkPolicySource(file, source).map((item) => item.code)

describe("effect-expo architectural policy", () => {
  it("rejects expo-network root and deep imports outside reviewed adapters", () => {
    expect(
      codes(
        "apps/example/src/network.ts",
        [
          'import * as Network from "expo-network"',
          'export { default as Native } from "expo-network/build/ExpoNetwork"'
        ].join("\n")
      )
    ).toEqual(["EFFECT_EXPO_RAW_CAPABILITY_IMPORT", "EFFECT_EXPO_RAW_CAPABILITY_IMPORT"])
  })

  it("allows the reviewed production adapter to import Expo", () => {
    expect(
      checkPolicySource(
        "packages/network/src/adapters/NetworkLive.ts",
        'import * as Network from "expo-network"\n'
      )
    ).toEqual([])
  })

  it("applies testing and runner boundaries to application and package production source", () => {
    const source = [
      'import { Effect } from "effect"',
      'import * as NetworkTest from "@effect-expo/network/testing"',
      "Effect.runPromise(program)"
    ].join("\n")

    expect(codes("apps/example/src/feature.ts", source)).toEqual([
      "EFFECT_EXPO_TESTING_IMPORT",
      "EFFECT_EXPO_UNMANAGED_RUNTIME"
    ])
    expect(codes("packages/domain/src/feature.ts", source)).toEqual([
      "EFFECT_EXPO_TESTING_IMPORT",
      "EFFECT_EXPO_UNMANAGED_RUNTIME"
    ])
  })

  it("does not exempt an application route merely because its directory is named test", () => {
    expect(
      codes(
        "apps/example/app/test/index.tsx",
        [
          'import * as Effect from "effect/Effect"',
          'import * as NetworkTest from "@effect-expo/network/testing"',
          "Effect.runFork(program)"
        ].join("\n")
      )
    ).toEqual(["EFFECT_EXPO_TESTING_IMPORT", "EFFECT_EXPO_UNMANAGED_RUNTIME"])
  })

  it("exempts explicit test, spec, eval, and generated files from production-only rules", () => {
    const source = [
      'import * as Effect from "effect/Effect"',
      'import * as NetworkTest from "@effect-expo/network/testing"',
      "Effect.runPromise(program)"
    ].join("\n")

    for (const file of [
      "packages/domain/src/feature.test.ts",
      "packages/domain/src/feature.spec.ts",
      "packages/domain/src/feature.eval.ts",
      "packages/domain/src/generated/feature.ts"
    ]) {
      expect(codes(file, source), file).toEqual([])
    }
  })

  it("covers every Effect v4 execution runner variant", () => {
    const runners = [
      "runFork",
      "runForkWith",
      "runCallback",
      "runCallbackWith",
      "runPromise",
      "runPromiseWith",
      "runPromiseExit",
      "runPromiseExitWith",
      "runSync",
      "runSyncWith",
      "runSyncExit",
      "runSyncExitWith"
    ]
    const source = [
      'import * as Fx from "effect/Effect"',
      ...runners.map((runner) => `Fx.${runner}(program)`)
    ].join("\n")

    expect(codes("packages/domain/src/program.ts", source)).toEqual(
      runners.map(() => "EFFECT_EXPO_UNMANAGED_RUNTIME")
    )
  })

  it("resolves concatenated computed properties on guarded namespaces", () => {
    const source = [
      'import * as Effect from "effect/Effect"',
      'import * as Expo from "expo"',
      'import * as ReactNative from "react-native"',
      'const runner = "run" + "Promise"',
      'const loader = "require" + "NativeModule"',
      'const modules = "Native" + "Modules"',
      'const native = "Expo" + "Network"',
      "Effect[runner](program)",
      "Expo[loader](native)",
      "ReactNative[modules][native]"
    ].join("\n")

    expect(codes("apps/example/src/computed.ts", source)).toEqual([
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT"
    ])
  })

  it("detects Reflect.get aliases, immediate calls, and destructuring", () => {
    const source = [
      'import * as Effect from "effect/Effect"',
      'import * as Expo from "expo"',
      'import * as ReactNative from "react-native"',
      'const runner = "run" + "Promise"',
      'const loader = "require" + "NativeModule"',
      'const modules = "Native" + "Modules"',
      'const native = "Expo" + "Network"',
      "Reflect.get(Effect, runner)(program)",
      "const execute = Reflect.get(Effect, runner)",
      "execute(program)",
      "Reflect.get(Expo, loader)(native)",
      "const load = Reflect.get(Expo, loader)",
      "load(native)",
      "Reflect.get(Reflect.get(ReactNative, modules), native)",
      "const { ExpoNetwork } = Reflect.get(ReactNative, modules)"
    ].join("\n")

    expect(codes("packages/domain/src/reflected.ts", source)).toEqual([
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT"
    ])
  })

  it("does not confuse a local Reflect binding with the global intrinsic", () => {
    const source = [
      'import * as Effect from "effect/Effect"',
      "function local(Reflect: { get: (target: unknown, key: string) => Function }) {",
      '  Reflect.get(Effect, "runPromise")(program)',
      "}"
    ].join("\n")

    expect(codes("packages/domain/src/reflected.ts", source)).toEqual([])
  })

  it("resolves Effect namespaces, imported runners, destructuring, and alias chains", () => {
    const source = [
      'import * as EffectRoot from "effect"',
      'import { runPromise as importedRunner } from "effect/Effect"',
      "const Fx = EffectRoot.Effect",
      "const { runFork: fork } = Fx",
      "const execute = importedRunner",
      "const executeAgain = execute",
      "Fx.runCallback(program)",
      "fork(program)",
      "executeAgain(program)"
    ].join("\n")

    expect(codes("apps/example/src/program.ts", source)).toEqual([
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_UNMANAGED_RUNTIME"
    ])
  })

  it("resolves Effect from root namespace and CommonJS destructuring", () => {
    const source = [
      'import * as EffectRoot from "effect"',
      "const { Effect: RootEffect } = EffectRoot",
      'const { Effect: RequiredEffect } = require("effect")',
      "RootEffect.runPromise(program)",
      "RequiredEffect.runSync(program)"
    ].join("\n")

    expect(codes("packages/domain/src/program.ts", source)).toEqual([
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_UNMANAGED_RUNTIME"
    ])
  })

  it("respects lexical shadowing of tracked imports", () => {
    const source = [
      'import { Effect } from "effect"',
      "Effect.runPromise(program)",
      "function local(Effect: { runPromise: (value: unknown) => void }) {",
      "  Effect.runPromise(program)",
      "}",
      'import * as Expo from "expo"',
      "function native(Expo: { requireNativeModule: (name: string) => unknown }) {",
      '  Expo.requireNativeModule("ExpoNetwork")',
      "}"
    ].join("\n")

    expect(codes("packages/domain/src/program.ts", source)).toEqual([
      "EFFECT_EXPO_UNMANAGED_RUNTIME"
    ])
  })

  it("detects runner invocation through call, apply, bind, and import-equals", () => {
    const source = [
      'import * as Effect from "effect/Effect"',
      'import Fx = require("effect/Effect")',
      "Effect.runPromise.call(undefined, program)",
      "Effect.runSync.apply(undefined, [program])",
      "const execute = Effect.runFork.bind(Effect)",
      "execute(program)",
      "Fx.runCallback(program)"
    ].join("\n")

    expect(codes("packages/domain/src/program.ts", source)).toEqual([
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_UNMANAGED_RUNTIME"
    ])
  })

  it("allows runners only in explicitly reviewed runtime entrypoints", () => {
    const source = 'import * as Fx from "effect/Effect"\nFx.runCallback(program)'

    expect(codes("apps/test-suite/src/runtime/network-runtime.ts", source)).toEqual([])
    expect(codes("packages/cli/src/bin.ts", source)).toEqual([])
    expect(codes("apps/example/src/runtime/another-runtime.ts", source)).toEqual([
      "EFFECT_EXPO_UNMANAGED_RUNTIME"
    ])
  })

  it("detects resolvable dynamic imports, require calls, and require.resolve", () => {
    const source = [
      'const packageName = "expo-" + "network"',
      'const deepPath = packageName + "/build/ExpoNetwork"',
      "import(packageName)",
      "require(deepPath)",
      "require.resolve(`expo-network`)",
      'const ignored = import("expo-" + unknownName)'
    ].join("\n")

    expect(codes("packages/domain/src/native.ts", source)).toEqual([
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT"
    ])
  })

  it("tracks awaited dynamic-import namespaces and destructured bindings", () => {
    const source = [
      'const Fx = (await import("effect/Effect"))',
      "Fx.runPromise(program)",
      'const { runSync: execute } = await import("effect/Effect")',
      "execute(program)",
      'const { Effect: RootEffect } = await import("effect")',
      "RootEffect.runFork(program)",
      'const Expo = await import("expo")',
      'Expo.requireNativeModule("ExpoNetwork")',
      'const { requireOptionalNativeModule: load } = await import("expo-modules-core")',
      'load("ExpoNetwork")',
      'const ReactNative = await import("react-native")',
      "ReactNative.NativeModules.ExpoNetwork"
    ].join("\n")

    expect(codes("apps/example/src/dynamic.ts", source)).toEqual([
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_UNMANAGED_RUNTIME",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT"
    ])
  })

  it("keeps dynamic-import namespace tracking lexical and shadow-safe", () => {
    const source = [
      'const Fx = await import("effect/Effect")',
      "function local(Fx) {",
      "  Fx.runPromise(program)",
      "}"
    ].join("\n")

    expect(codes("apps/example/src/dynamic.js", source)).toEqual([])
  })

  it("detects import-equals and module.require guarded imports", () => {
    const source = [
      'import Network = require("expo-network")',
      'module.require("expo-network/build/ExpoNetwork")'
    ].join("\n")

    expect(codes("packages/domain/src/native.ts", source)).toEqual([
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT"
    ])
  })

  it("detects guarded imports through CommonJS loader aliases", () => {
    const source = [
      "const load = require",
      "const loadAgain = load",
      "const resolve = require.resolve",
      'const packageName = "expo-" + "network"',
      "loadAgain(packageName)",
      'resolve(packageName + "/build/ExpoNetwork")'
    ].join("\n")

    expect(codes("packages/domain/src/native.ts", source)).toEqual([
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT"
    ])
  })

  it("detects Expo native loaders through named, namespace, and aliased access", () => {
    const source = [
      'import * as Expo from "expo"',
      'import { requireOptionalNativeModule as optional } from "expo-modules-core"',
      'const moduleName = "Expo" + "Network"',
      "const load = Expo.requireNativeModule",
      "load(moduleName)",
      'optional("ExpoNetwork")',
      'Expo.requireOptionalNativeModule("OtherModule")'
    ].join("\n")

    expect(codes("apps/example/src/native.ts", source)).toEqual([
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT"
    ])
  })

  it("detects destructured Expo loaders and React Native modules", () => {
    const source = [
      'import * as Expo from "expo"',
      'import * as ReactNative from "react-native"',
      "const { requireNativeModule: load } = Expo",
      "const { NativeModules: Modules } = ReactNative",
      'load("ExpoNetwork")',
      "Modules.ExpoNetwork"
    ].join("\n")

    expect(codes("apps/example/src/native.ts", source)).toEqual([
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT"
    ])
  })

  it("detects concrete React Native and Expo NativeModulesProxy access", () => {
    const source = [
      'import * as ReactNative from "react-native"',
      'import { NativeModules as Modules } from "react-native"',
      'import { NativeModulesProxy as Proxy } from "expo-modules-core"',
      "const Alias = Modules",
      "Alias.ExpoNetwork.getNetworkStateAsync()",
      'ReactNative.NativeModules["ExpoNetwork"]',
      "const { ExpoNetwork: NetworkModule } = Proxy",
      "Proxy.OtherModule"
    ].join("\n")

    expect(codes("apps/example/src/native.ts", source)).toEqual([
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      "EFFECT_EXPO_RAW_CAPABILITY_IMPORT"
    ])
  })

  it("does not diagnose unrelated local objects, type imports, comments, or strings", () => {
    const source = [
      'import type * as Effect from "effect/Effect"',
      "const EffectValue = { runPromise: (_value: unknown) => undefined }",
      "const NativeModules = { ExpoNetwork: undefined }",
      "EffectValue.runPromise(program)",
      "NativeModules.ExpoNetwork",
      '// import * as Network from "expo-network"',
      'const example = "Effect.runPromise(program)"'
    ].join("\n")

    expect(codes("apps/example/src/feature.ts", source)).toEqual([])
  })

  it("parses JavaScript-family production extensions", () => {
    for (const extension of ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"]) {
      expect(
        codes(
          `packages/domain/src/program.${extension}`,
          'import * as Effect from "effect/Effect"\nEffect.runPromise(program)'
        ),
        extension
      ).toEqual(["EFFECT_EXPO_UNMANAGED_RUNTIME"])
    }
  })

  it("recognizes direct CommonJS require and required namespaces in JavaScript files", () => {
    for (const extension of ["js", "jsx", "mjs", "cjs"]) {
      const source = [
        'require("expo-network")',
        'const Fx = require("effect/Effect")',
        'const Expo = require("expo")',
        'const ReactNative = require("react-native")',
        "Fx.runPromise(program)",
        'Expo.requireNativeModule("ExpoNetwork")',
        "ReactNative.NativeModules.ExpoNetwork"
      ].join("\n")

      expect(codes(`packages/domain/src/commonjs.${extension}`, source), extension).toEqual([
        "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
        "EFFECT_EXPO_UNMANAGED_RUNTIME",
        "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
        "EFFECT_EXPO_RAW_CAPABILITY_IMPORT"
      ])
    }
  })

  it("does not treat locally shadowed JavaScript require bindings as CommonJS loaders", () => {
    for (const extension of ["js", "jsx", "mjs", "cjs"]) {
      const parameterSource = [
        "function local(require) {",
        '  require("expo-network")',
        '  const Fx = require("effect/Effect")',
        "  Fx.runPromise(program)",
        "}"
      ].join("\n")
      const localSource = ["const require = (name) => ({ name })", 'require("expo-network")'].join(
        "\n"
      )

      expect(
        codes(`packages/domain/src/parameter.${extension}`, parameterSource),
        extension
      ).toEqual([])
      expect(codes(`packages/domain/src/local.${extension}`, localSource), extension).toEqual([])
    }
  })

  it("bounds and sanitizes diagnostic rendering", () => {
    const unsafe = makeDiagnostic({
      code: "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
      file: `apps/example/\n${"f".repeat(2_000)}.ts`,
      line: Number.POSITIVE_INFINITY,
      capability: `network\u0000${"x".repeat(200)}`,
      message: `unsafe\r\n${"m".repeat(2_000)}`,
      help: `help\t${"h".repeat(3_000)}`
    })
    const diagnostics = Array.from({ length: DiagnosticLimits.count + 10 }, () => unsafe)

    expect(unsafe.file.length).toBeLessThanOrEqual(DiagnosticLimits.file)
    expect(unsafe.message.length).toBeLessThanOrEqual(DiagnosticLimits.message)
    expect(unsafe.help.length).toBeLessThanOrEqual(DiagnosticLimits.help)
    expect(
      Array.from(`${unsafe.file}${unsafe.capability}${unsafe.message}${unsafe.help}`).some(
        (character) => {
          const codePoint = character.codePointAt(0) ?? 0
          return codePoint < 32 || (codePoint >= 127 && codePoint <= 159)
        }
      )
    ).toBe(false)
    expect(unsafe.line).toBe(1)

    for (const format of ["human", "json"] as const) {
      const output = renderDiagnostics(diagnostics, format)
      expect(output.length).toBeLessThanOrEqual(DiagnosticLimits.output)
      expect(output).not.toContain("\u0000")
      if (format === "json") {
        const parsed = JSON.parse(output) as {
          diagnostics: ReadonlyArray<unknown>
          omitted: number
        }
        expect(parsed.diagnostics).toHaveLength(DiagnosticLimits.count)
        expect(parsed.omitted).toBe(10)
      }
    }
  })

  it("preserves the empty JSON diagnostic envelope", () => {
    expect(JSON.parse(renderDiagnostics([], "json"))).toEqual({
      schemaVersion: 1,
      diagnostics: []
    })
  })

  it("detects internal re-exports", () => {
    expect(
      codes(
        "packages/domain/src/public.ts",
        'export { Network } from "@effect-expo/network/src/generated/Network"'
      )
    ).toEqual(["EFFECT_EXPO_INTERNAL_IMPORT"])
  })

  it("rejects relative testing and cross-package internal imports", () => {
    expect(
      codes(
        "packages/domain/src/feature.ts",
        [
          'import { layer } from "../../network/src/testing/NetworkTest.ts"',
          'import { NetworkState } from "../../network/src/contracts/NetworkContract.ts"'
        ].join("\n")
      )
    ).toEqual(["EFFECT_EXPO_TESTING_IMPORT", "EFFECT_EXPO_INTERNAL_IMPORT"])

    expect(
      codes(
        "packages/network/src/index.ts",
        'export { NetworkState } from "./contracts/NetworkContract.ts"'
      )
    ).toEqual([])
  })

  it("normalizes Windows paths for reviewed entrypoints", () => {
    expect(
      checkPolicySource(
        "packages\\network\\src\\adapters\\NetworkLive.ts",
        'import * as Network from "expo-network"\n'
      )
    ).toEqual([])
  })

  it("keeps testing utilities on the explicit subpath only", () => {
    const networkPackage = JSON.parse(readFileSync("packages/network/package.json", "utf8")) as {
      exports: Record<string, string>
    }
    const networkIndex = readFileSync("packages/network/src/index.ts", "utf8")

    expect(networkPackage.exports["./testing"]).toBe("./src/testing/NetworkTest.ts")
    expect(networkIndex).not.toContain("NetworkTest")
  })
})
