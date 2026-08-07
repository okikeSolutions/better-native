import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as TestConsole from "effect/testing/TestConsole"
import * as Compatibility from "./Compatibility.ts"
import * as Coverage from "./Coverage.ts"
import { Ownership } from "./Domain.ts"
import * as ExpoRepository from "./ExpoRepository.ts"
import * as HarnessConfig from "./HarnessConfig.ts"
import { provideLayer } from "./TestLayers.ts"

const root = process.cwd()
const layer = ExpoRepository.layer(root).pipe(
  Layer.provideMerge(
    Layer.merge(
      NodeServices.layer,
      HarnessConfig.layer(root).pipe(Layer.provide(NodeServices.layer)),
    ),
  ),
)

describe("compatibility denominator integration", () => {
  it.effect(
    "validates and reports the real pinned catalog, surface, installation and ownership data",
    () =>
      Effect.gen(function* () {
        yield* Compatibility.validate()
        const coverage = yield* Coverage.inspect()
        yield* Coverage.print(coverage, { json: false })
        yield* Coverage.print(coverage, { json: true })

        const repository = yield* ExpoRepository.ExpoRepository
        const ownership = yield* repository.readJson("compatibility/ownership.json", Ownership)
        const keepAwake = ownership.overrides.find(
          (entry) => entry.package === "expo-keep-awake" && entry.subpath === ".",
        )
        const secureStore = ownership.overrides.find(
          (entry) => entry.package === "expo-secure-store" && entry.subpath === ".",
        )

        const output = (yield* TestConsole.logLines).join("\n")
        assert.strictEqual(keepAwake?.status, "effect")
        assert.strictEqual(keepAwake?.replacement, "@better-native/keep-awake/expo")
        assert.match(keepAwake?.reason ?? "", /paired upstream\/candidate evidence/i)
        assert.strictEqual(secureStore?.status, "upstream")
        assert.strictEqual(secureStore?.replacement, "@better-native/secure-store/expo")
        assert.include(output, "Validated Expo")
        assert.include(output, "Better Native API coverage")
        assert.include(output, '"schemaVersion": 5')
        assert.include(output, '"expoTypes": 4')
        assert.include(output, '"accountedTypes": 4')
        assert.include(output, '"expoType": "KeepAwakeOptions"')
        assert.include(output, '"target": "@better-native/keep-awake/expo#KeepAwakeOptions"')
        assert.include(output, '"deprecatedExpoApis": 1')
        assert.include(output, '"deprecated": true')
        assert.include(output, '"atomTarget": "@better-native/keep-awake#keepAwakeAtom"')
        assert.include(output, '"target": "@better-native/keep-awake#ExpoKeepAwakeTag"')
        assert.include(output, '"target": "@better-native/keep-awake#activateKeepAwake"')
        assert.include(output, '"target": "@better-native/keep-awake#addListener"')
        assert.include(output, '"target": "@better-native/keep-awake#KeepAwakeEventState"')
        assert.include(output, '"packageName": "expo-secure-store"')
        assert.include(output, '"target": "@better-native/secure-store#getItemAsync"')
        assert.include(output, '"expoType": "SecureStoreOptions"')
      }).pipe(provideLayer(layer)),
    120_000,
  )
})
