import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
import { AppWorkspace, layer } from "./AppWorkspace.ts"
import type { PinnedExpoToolchain } from "./BuildModel.ts"

const request = {
  id: "fixture-isolation",
  mode: "upstream" as const,
  platform: "ios" as const,
  expoRevision: "1".repeat(40),
  candidateRevision: null,
  timeoutMillis: 1_000,
}

const FixtureManifest = Schema.Struct({
  name: Schema.String,
  expo: Schema.Struct({ autolinking: Schema.Struct({ exclude: Schema.Array(Schema.String) }) }),
})

const MaterializedManifest = Schema.Struct({
  expo: Schema.Struct({
    autolinking: Schema.Struct({ searchPaths: Schema.Array(Schema.String) }),
  }),
})

describe("AppWorkspace", () => {
  it.effect("preserves fixture autolinking instead of injecting global module search paths", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-fixture-" })
      for (const directory of ["apps/compatibility-suite", "node_modules", "packages", "vendor"]) {
        yield* fs.makeDirectory(`${root}/${directory}`, { recursive: true })
      }
      const expoRoot = `${root}/expo-source`
      yield* fs.makeDirectory(`${expoRoot}/packages`, { recursive: true })
      const toolchain: PinnedExpoToolchain = {
        root: expoRoot,
        nodeModules: `${expoRoot}/node_modules`,
        artifacts: [],
        observations: [],
      }
      const sourceManifest = {
        name: "fixture",
        expo: { autolinking: { exclude: ["known-incompatible-module"] } },
      }
      yield* fs.writeFileString(
        `${root}/apps/compatibility-suite/package.json`,
        `${JSON.stringify(sourceManifest)}\n`,
      )

      const prepared = yield* Effect.gen(function* () {
        const workspace = yield* AppWorkspace
        return yield* workspace.prepare(request, toolchain)
      }).pipe(Effect.provide(layer(root)))
      const materialized = yield* Schema.decodeUnknownEffect(FixtureManifest)(
        JSON.parse(yield* fs.readFileString(`${prepared.appDirectory}/package.json`)) as unknown,
      )

      assert.deepStrictEqual(materialized, sourceManifest)
      assert.notProperty(materialized.expo.autolinking, "searchPaths")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect("resolves Expo-owned dependencies from pinned source and third parties from root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-fixture-" })
      const expoRoot = `${root}/expo-source`
      for (const directory of [
        `${root}/apps/compatibility-suite`,
        `${root}/apps/compatibility-suite/node_modules/expo/ios/AppDelegates`,
        `${root}/node_modules/expo/ios/AppDelegates`,
        `${root}/node_modules/expo-modules-core`,
        `${root}/node_modules/third-party`,
        `${root}/packages`,
        `${root}/vendor`,
        `${expoRoot}/packages/expo/ios/AppDelegates`,
        `${expoRoot}/packages/expo-modules-core`,
      ]) {
        yield* fs.makeDirectory(directory, { recursive: true })
      }
      yield* fs.writeFileString(
        `${root}/apps/compatibility-suite/node_modules/expo/package.json`,
        JSON.stringify({ name: "expo", version: "57.0.9-app-local" }),
      )
      yield* fs.writeFileString(
        `${root}/apps/compatibility-suite/node_modules/expo/ios/AppDelegates/AppLocalOnly.swift`,
        "public class AppLocalOnly {}",
      )
      yield* fs.writeFileString(
        `${root}/apps/compatibility-suite/package.json`,
        `${JSON.stringify({ dependencies: { expo: "57.0.9", "third-party": "1.0.0" } })}\n`,
      )
      yield* fs.writeFileString(
        `${root}/node_modules/expo/package.json`,
        JSON.stringify({ name: "expo", version: "57.0.9-registry" }),
      )
      yield* fs.writeFileString(
        `${root}/node_modules/expo/ios/AppDelegates/RegistryOnly.swift`,
        "public class RegistryOnly {}",
      )
      yield* fs.writeFileString(
        `${root}/node_modules/expo-modules-core/package.json`,
        JSON.stringify({ name: "expo-modules-core", version: "registry" }),
      )
      yield* fs.writeFileString(
        `${root}/node_modules/third-party/package.json`,
        JSON.stringify({ name: "third-party" }),
      )
      yield* fs.writeFileString(
        `${expoRoot}/packages/expo/package.json`,
        JSON.stringify({ name: "expo" }),
      )
      yield* fs.writeFileString(
        `${expoRoot}/packages/expo-modules-core/package.json`,
        JSON.stringify({ name: "expo-modules-core", version: "pinned" }),
      )
      yield* fs.writeFileString(
        `${expoRoot}/packages/expo/ios/AppDelegates/ExpoReactNativeFactoryProvider.swift`,
        "public class ExpoReactNativeFactoryProvider {}",
      )
      const toolchain: PinnedExpoToolchain = {
        root: expoRoot,
        nodeModules: `${expoRoot}/node_modules`,
        artifacts: [],
        observations: [],
      }

      const prepared = yield* Effect.gen(function* () {
        const workspace = yield* AppWorkspace
        const materialized = yield* workspace.prepare(request, toolchain)
        const selected = yield* workspace.pinNativePackages(request, materialized, [
          "third-party",
          "expo-modules-core",
        ])
        assert.deepStrictEqual(selected, [
          {
            name: "expo-modules-core",
            source: yield* fs.realPath(`${expoRoot}/packages/expo-modules-core`),
          },
        ])
        return materialized
      }).pipe(Effect.provide(layer(root)))
      const canonicalExpoPackage = yield* fs.realPath(`${expoRoot}/packages/expo`)
      const canonicalExpoModulesCore = yield* fs.realPath(`${expoRoot}/packages/expo-modules-core`)
      const canonicalThirdPartyPackage = yield* fs.realPath(`${root}/node_modules/third-party`)

      assert.strictEqual(
        yield* fs.realPath(`${prepared.workspace}/node_modules/expo`),
        canonicalExpoPackage,
      )
      assert.strictEqual(
        yield* fs.realPath(`${prepared.workspace}/node_modules/expo-modules-core`),
        canonicalExpoModulesCore,
      )
      assert.strictEqual(
        yield* fs.realPath(`${prepared.workspace}/node_modules/third-party`),
        canonicalThirdPartyPackage,
      )
      assert.deepStrictEqual(prepared.expoPackageResolutions, [
        { name: "expo", source: canonicalExpoPackage },
      ])
      assert.deepStrictEqual(prepared.pinnedExpoPackages, [
        { name: "expo", source: canonicalExpoPackage },
        { name: "expo-modules-core", source: canonicalExpoModulesCore },
      ])
      assert.isTrue(
        yield* fs.exists(
          `${prepared.workspace}/node_modules/expo/ios/AppDelegates/ExpoReactNativeFactoryProvider.swift`,
        ),
      )
      assert.isFalse(
        yield* fs.exists(
          `${prepared.workspace}/node_modules/expo/ios/AppDelegates/RegistryOnly.swift`,
        ),
      )
      assert.isFalse(
        yield* fs.exists(
          `${prepared.workspace}/node_modules/expo/ios/AppDelegates/AppLocalOnly.swift`,
        ),
      )
      assert.isFalse(yield* fs.exists(`${prepared.appDirectory}/node_modules`))
      assert.strictEqual(
        yield* fs.realPath(`${prepared.workspace}/native-node-modules/expo-modules-core`),
        canonicalExpoModulesCore,
      )
      assert.isFalse(yield* fs.exists(`${prepared.workspace}/native-node-modules/expo`))
      const materializedManifest = yield* Schema.decodeUnknownEffect(MaterializedManifest)(
        JSON.parse(yield* fs.readFileString(`${prepared.appDirectory}/package.json`)) as unknown,
      )
      assert.deepStrictEqual(materializedManifest.expo.autolinking.searchPaths, [
        "../../native-node-modules",
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
