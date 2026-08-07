import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Verifier from "../Verifier.ts"
import { makeConfig, makeTestLayer, observeSource } from "../IsolationTestSupport.ts"
import { provideLayer } from "../../TestLayers.ts"

describe("runtime restriction isolation", () => {
  it.effect("runs candidate Effects without the runner's NodeServices context", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=service-context-${process.pid}-${Date.now()}`,
    )
    return observeSource(`
import * as Effect from "effect/Effect"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

export const candidate = Effect.as(ChildProcessSpawner.ChildProcessSpawner, "service-leaked")
`).pipe(
      Effect.tap(({ observation }) =>
        Effect.gen(function* () {
          assert.strictEqual(observation.exitCode, 0)
          assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
            schemaVersion: 1,
            kind: "effect-failure",
          })
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })

  it.effect("disables dynamic string and WebAssembly code generation in candidate workers", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=codegen-${process.pid}-${Date.now()}`,
    )
    return observeSource(`
import * as Effect from "effect/Effect"

export const candidate = Effect.sync(() => {
  let stringCodegen = "blocked"
  try {
    globalThis.eval("1 + 1")
    stringCodegen = "allowed"
  } catch {}
  return { stringCodegen, webAssembly: typeof globalThis.WebAssembly }
})
`).pipe(
      Effect.tap(({ observation }) =>
        Effect.gen(function* () {
          assert.strictEqual(observation.exitCode, 0)
          assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
            schemaVersion: 1,
            kind: "effect",
            value: { stringCodegen: "blocked", webAssembly: "undefined" },
          })
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })
})
