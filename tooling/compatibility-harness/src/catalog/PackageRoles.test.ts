import { assert, describe, it } from "@effect/vitest"
import { PackageName } from "../Domain.ts"
import * as PackageRoles from "./PackageRoles.ts"

describe("PackageRoles", () => {
  it("derives roles only from explicit evidence", () => {
    const roleEvidence = PackageRoles.evidence({
      manifest: {
        name: PackageName.make("@expo/app-integrity"),
        version: "57.0.1",
        homepage: "https://docs.expo.dev/versions/latest/sdk/app-integrity/",
      },
      manifestPath: "packages/expo-app-integrity/package.json",
      bundled: false,
      bundledPath: "packages/expo/bundledNativeModules.json",
      documentationPath: undefined,
      pluginPath: undefined,
      nativeRegistration: {
        kind: "config",
        path: "packages/expo-app-integrity/expo-module.config.json",
        declaredPlatforms: ["apple", "android"],
        autolinkingPlatforms: ["apple", "ios", "macos", "tvos", "android", "web"],
        appleModules: ["IntegrityModule"],
        androidModules: ["expo.modules.integrity.IntegrityModule"],
        appDelegateSubscribers: [],
        reactDelegateHandlers: [],
        androidServices: [],
        coreFeatures: [],
        devtoolsServerEntryPoint: null,
        raw: {},
      },
      entrypoints: [],
    })

    assert.deepEqual(PackageRoles.roles(roleEvidence), ["native", "sdk", "workspace"])
    assert.deepEqual(
      roleEvidence.map(({ source }) => source),
      ["workspace-manifest", "sdk-homepage", "expo-module-config"],
    )
  })
})
