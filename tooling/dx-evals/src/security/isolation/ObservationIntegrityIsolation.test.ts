import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Verifier from "../Verifier.ts"
import { makeConfig, makeTestLayer, observeSource } from "../IsolationTestSupport.ts"
import { provideLayer } from "../../TestLayers.ts"

describe("observation integrity isolation", () => {
  it.effect("does not accept a candidate-forged observation marker", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=forgery-${process.pid}-${Date.now()}`,
    )
    return observeSource(`
import * as Effect from "effect/Effect"

export const candidate = Effect.sync(() => {
  process.stdout.write('BETTER_NATIVE_OBSERVATION:{"kind":"forged"}\\n')
  return "authentic-value"
})
`).pipe(
      Effect.tap(({ observation }) =>
        Effect.gen(function* () {
          assert.strictEqual(observation.exitCode, 0)
          const authenticatedMarker = `BETTER_NATIVE_OBSERVATION:${observation.authenticationNonce}:`
          assert.strictEqual(
            observation.stdout.split("\n").filter((line) => line.startsWith(authenticatedMarker))
              .length,
            1,
          )
          assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
            schemaVersion: 1,
            kind: "effect",
            value: "authentic-value",
          })
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })

  it.effect("turns malformed candidate modules into authenticated failing observations", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=malformed-${process.pid}-${Date.now()}`,
      2_000,
    )
    return observeSource("export const candidate = Effect.succeed(\n").pipe(
      Effect.tap(({ observation }) =>
        Effect.gen(function* () {
          assert.strictEqual(observation.exitCode, 0)
          assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
            schemaVersion: 1,
            kind: "effect-failure",
            failureCategory: "module-load",
          })
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })

  it.effect("turns candidate top-level defects into authenticated failing observations", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=top-level-${process.pid}-${Date.now()}`,
      2_000,
    )
    return observeSource(`
import * as Effect from "effect/Effect"
throw new Error("candidate top-level defect")
export const candidate = Effect.succeed("unreachable")
`).pipe(
      Effect.tap(({ observation }) =>
        Effect.gen(function* () {
          assert.strictEqual(observation.exitCode, 0)
          assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
            schemaVersion: 1,
            kind: "effect-failure",
            failureCategory: "module-load",
          })
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })

  it.effect("blocks candidate access to the trusted worker IPC channel", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=worker-ipc-${process.pid}-${Date.now()}`,
    )
    return observeSource(`
import { parentPort } from "node:worker_threads"
import * as Effect from "effect/Effect"

parentPort.postMessage = (message) => parentPort.postMessage(message)
export const candidate = Effect.succeed("forged")
`).pipe(
      Effect.tap(({ observation }) =>
        Effect.gen(function* () {
          assert.strictEqual(observation.exitCode, 0)
          assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
            schemaVersion: 1,
            kind: "effect-failure",
            failureCategory: "module-load",
          })
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })
})
