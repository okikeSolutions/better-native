import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { makeConfig, makeTestLayer, observeSource } from "../IsolationTestSupport.ts"
import { provideLayer } from "../../TestLayers.ts"

it.effect("denies outbound network access", () => {
  const config = makeConfig(
    `io.better-native.dx-evals.conformance=network-${process.pid}-${Date.now()}`,
  )
  return observeSource(`
import * as Effect from "effect/Effect"

export const candidate = Effect.promise(async () => {
  try {
    await fetch("https://example.com", { signal: AbortSignal.timeout(2_000) })
    return "network-allowed"
  } catch {
    return "network-denied"
  }
})
`).pipe(
    Effect.tap(({ observation }) =>
      Effect.sync(() => {
        assert.strictEqual(observation.exitCode, 0)
        assert.match(observation.stdout, /"value":"network-denied"/)
      }),
    ),
    provideLayer(makeTestLayer(config)),
  )
})
