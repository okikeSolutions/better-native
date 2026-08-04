import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { ProcessObservation } from "../Domain.ts"
import type { PreparedAppWorkspace } from "./AppWorkspace.ts"
import {
  NativeResolutionError,
  discoverNativeExpoPackages,
  validateNativeResolution,
} from "./NativeResolution.ts"

const observation = (value: unknown): ReadonlyArray<ProcessObservation> => [
  { sequence: 0, timestampMillis: 0, stream: "stdout", text: JSON.stringify(value) },
]

const workspace: PreparedAppWorkspace = {
  workspace: "/workspace",
  appDirectory: "/workspace/apps/compatibility-suite",
  packageResolutionManifest: "/workspace/expo-package-resolutions.json",
  expoPackageResolutions: [{ name: "expo", source: "/pinned/packages/expo" }],
  dependencyResolutions: [
    { name: "expo", source: "/pinned/packages/expo", owner: "pinned-expo" },
    {
      name: "react-native-screens",
      source: "/root/node_modules/react-native-screens",
      owner: "root",
    },
  ],
  pinnedExpoPackages: [
    { name: "expo", source: "/pinned/packages/expo" },
    { name: "expo-modules-core", source: "/pinned/packages/expo-modules-core" },
  ],
}

describe("NativeResolution", () => {
  it.effect("discovers the native Expo package closure", () =>
    Effect.gen(function* () {
      const packages = yield* discoverNativeExpoPackages(
        observation({
          modules: [
            { packageName: "expo-modules-core" },
            { packageName: "expo" },
            { packageName: "expo-modules-core" },
          ],
        }),
      )

      assert.deepStrictEqual(packages, ["expo", "expo-modules-core"])
    }),
  )

  it.effect("accepts matching direct and transitive native package roots", () =>
    validateNativeResolution({
      workspace,
      expoModules: observation({
        modules: [
          { packageName: "expo", pods: [{ podspecDir: "/pinned/packages/expo" }] },
          {
            packageName: "expo-modules-core",
            projects: [{ sourceDir: "/pinned/packages/expo-modules-core/android" }],
          },
        ],
      }),
      reactNativeModules: observation({
        dependencies: {
          expo: { root: "/pinned/packages/expo" },
          "react-native-screens": { root: "/root/node_modules/react-native-screens" },
          "transitive-third-party": { root: "/root/node_modules/transitive-third-party" },
        },
      }),
    }),
  )

  it.effect("rejects a registry package replacing pinned Expo source", () =>
    validateNativeResolution({
      workspace,
      expoModules: observation({
        modules: [{ packageName: "expo", pods: [{ podspecDir: "/root/node_modules/expo" }] }],
      }),
      reactNativeModules: observation({ dependencies: {} }),
    }).pipe(
      Effect.flip,
      Effect.map((failure) => {
        assert.instanceOf(failure, NativeResolutionError)
        assert.match(String(failure.cause), /expected materialization/)
      }),
    ),
  )
})
