import { assert, describe, it } from "@effect/vitest"
import {
  canonicalNativeFingerprintSources,
  isGeneratedExpoNativeOutput,
  nativeClosureFingerprintInput,
} from "./NativeFingerprint.ts"

const configSource = (mode: "upstream" | "candidate", buildId: string) => ({
  type: "contents",
  id: "expoConfig",
  contents: JSON.stringify({
    name: "Compatibility",
    extra: {
      betterNativeMode: mode,
      betterNativeBuildId: buildId,
      eas: { projectId: "fixed" },
    },
  }),
  hash: `${mode}-${buildId}`,
})

describe("native closure fingerprint", () => {
  it("excludes generated Expo compiler products without excluding config-plugin code", () => {
    assert.isTrue(
      isGeneratedExpoNativeOutput(
        "../../expo/packages/expo-location/android/build/intermediates/output.bin",
      ),
    )
    assert.isTrue(
      isGeneratedExpoNativeOutput("../../expo/packages/expo-modules-jsi/apple/Products/module.a"),
    )
    assert.isFalse(
      isGeneratedExpoNativeOutput("../../expo/packages/expo-location/plugin/build/withLocation.js"),
    )
  })

  it("shares one native closure across upstream and candidate JS cohorts", () => {
    const nativeSource = {
      type: "file",
      filePath: "../../expo/packages/expo-location/ios/LocationModule.swift",
      hash: "native-source",
    }
    const generated = {
      type: "file",
      filePath: "../../expo/packages/expo-location/android/build/generated/output",
      hash: "generated-output",
    }
    const upstream = nativeClosureFingerprintInput(
      canonicalNativeFingerprintSources([configSource("upstream", "upstream-id"), nativeSource]),
    )
    const candidate = nativeClosureFingerprintInput(
      canonicalNativeFingerprintSources([
        generated,
        configSource("candidate", "candidate-id"),
        nativeSource,
      ]),
    )

    assert.deepStrictEqual(upstream, candidate)
  })

  it("retains native configuration differences", () => {
    const left = nativeClosureFingerprintInput([
      { type: "contents", id: "expoConfig", contents: '{"ios":{"bundleIdentifier":"a"}}' },
    ])
    const right = nativeClosureFingerprintInput([
      { type: "contents", id: "expoConfig", contents: '{"ios":{"bundleIdentifier":"b"}}' },
    ])
    assert.notDeepEqual(left, right)
  })
})
