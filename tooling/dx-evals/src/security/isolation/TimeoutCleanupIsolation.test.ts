import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"
import {
  awaitNoContainers,
  makeConfig,
  makeTestLayer,
  observeSource,
} from "../IsolationTestSupport.ts"
import { provideLayer } from "../../TestLayers.ts"

it.effect("kills timed-out trials and leaves no labeled containers", () => {
  const config = makeConfig(
    `io.better-native.dx-evals.conformance=timeout-${process.pid}-${Date.now()}`,
    750,
  )
  return Effect.gen(function* () {
    const failure = yield* Effect.flip(
      observeSource(`
import * as Effect from "effect/Effect"

export const candidate = Effect.never
`).pipe(TestClock.withLive),
    )
    assert.strictEqual(failure.reason, "timeout")
    assert.deepStrictEqual(yield* awaitNoContainers(config), [])
  }).pipe(provideLayer(makeTestLayer(config)))
})
