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
        const battery = ownership.overrides.find(
          (entry) => entry.package === "expo-battery" && entry.subpath === ".",
        )
        const network = ownership.overrides.find(
          (entry) => entry.package === "expo-network" && entry.subpath === ".",
        )
        const keepAwake = ownership.overrides.find(
          (entry) => entry.package === "expo-keep-awake" && entry.subpath === ".",
        )
        const secureStore = ownership.overrides.find(
          (entry) => entry.package === "expo-secure-store" && entry.subpath === ".",
        )
        const sqlite = ownership.overrides.find(
          (entry) => entry.package === "expo-sqlite" && entry.subpath === ".",
        )
        const taskManager = ownership.overrides.find(
          (entry) => entry.package === "expo-task-manager" && entry.subpath === ".",
        )
        const backgroundTask = ownership.overrides.find(
          (entry) => entry.package === "expo-background-task" && entry.subpath === ".",
        )

        const output = (yield* TestConsole.logLines).join("\n")
        assert.strictEqual(battery?.status, "effect")
        assert.strictEqual(battery?.replacement, "@better-native/battery/expo")
        assert.match(battery?.reason ?? "", /paired upstream\/candidate Release evidence/i)
        assert.strictEqual(network?.status, "effect")
        assert.strictEqual(network?.replacement, "@better-native/network/expo")
        assert.match(network?.reason ?? "", /paired upstream\/candidate Release evidence/i)
        assert.strictEqual(keepAwake?.status, "effect")
        assert.strictEqual(keepAwake?.replacement, "@better-native/keep-awake/expo")
        assert.match(keepAwake?.reason ?? "", /paired upstream\/candidate evidence/i)
        assert.strictEqual(secureStore?.status, "effect")
        assert.strictEqual(secureStore?.replacement, "@better-native/secure-store/expo")
        assert.match(secureStore?.reason ?? "", /paired upstream\/candidate evidence/i)
        assert.strictEqual(sqlite?.status, "effect")
        assert.strictEqual(sqlite?.replacement, "@better-native/sqlite/expo")
        assert.match(sqlite?.reason ?? "", /paired upstream\/candidate Release evidence/i)
        assert.strictEqual(taskManager?.status, "fallback")
        assert.strictEqual(taskManager?.replacement, "@better-native/task-manager/expo")
        assert.match(taskManager?.reason ?? "", /physical-device background and cold-launch/i)
        assert.strictEqual(backgroundTask?.status, "fallback")
        assert.strictEqual(backgroundTask?.replacement, "@better-native/background-task/expo")
        assert.match(backgroundTask?.reason ?? "", /physical-device scheduled and cold-launch/i)
        assert.include(output, "Validated Expo")
        assert.include(output, "Better Native API coverage")
        assert.include(output, "expo-sqlite")
        assert.include(output, '"packageName": "expo-sqlite"')
        assert.include(output, '"target": "@better-native/sqlite#openDatabaseAsync"')
        assert.include(output, '"target": "@better-native/sqlite#addDatabaseChangeListener"')
        assert.include(output, '"expoType": "SQLiteOpenOptions"')
        assert.include(output, '"schemaVersion": 6')
        assert.include(output, '"unmigratedHooks": 0')
        assert.include(output, '"atomTarget": "@better-native/sqlite#sqliteClientAtom"')
        assert.include(output, '"packageName": "expo-task-manager"')
        assert.include(output, '"target": "@better-native/task-manager#isTaskDefined"')
        assert.include(output, '"expoType": "TaskManagerTaskBody"')
        assert.include(output, '"packageName": "expo-background-task"')
        assert.include(output, '"target": "@better-native/background-task#registerTaskAsync"')
        assert.include(output, '"expoType": "BackgroundTaskOptions"')
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
