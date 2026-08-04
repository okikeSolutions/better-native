import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as AppRegistry from "./AppRegistry.ts"

describe("AppRegistry", () => {
  it.effect("loads device-test metadata without an Expo repository service", () =>
    Effect.gen(function* () {
      const metadata = yield* AppRegistry.loadMetadata()
      assert.isAbove(metadata.sources.length, 0)
      assert.isAbove(AppRegistry.appExecutionUnits(metadata, "ios").length, 0)
      assert.isAbove(AppRegistry.appExecutionUnits(metadata, "android").length, 0)
    }).pipe(Effect.provide(NodeServices.layer)),
  )

  it("derives Expo's active native E2E names without enabling commented tests", () => {
    const names = AppRegistry.upstreamNativeE2eNames(`
      const TESTS = [
        'Basic',
        // 'Asset',
        'SQLite',
        /* 'Font', */
      ];
    `)
    assert.deepEqual([...names], ["Basic", "SQLite"])
  })

  it.effect("routes only Expo's pinned native E2E cohort to device execution", () =>
    Effect.gen(function* () {
      const metadata = yield* AppRegistry.loadMetadata()
      const names = AppRegistry.appExecutionUnits(metadata, "ios").map(
        ({ sourceId }) =>
          metadata.sources.find((source) => source.sourceId === sourceId)?.runtimeName,
      )
      assert.deepEqual(
        names.toSorted((left, right) => String(left).localeCompare(String(right))),
        [
          "AppMetrics",
          "Basic",
          "Constants",
          "Crypto",
          "Fetch",
          "FileSystem",
          "Haptics",
          "KeepAwake",
          "Localization",
          "SQLite",
        ],
      )
    }).pipe(Effect.provide(NodeServices.layer)),
  )
})
