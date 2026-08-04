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
})
