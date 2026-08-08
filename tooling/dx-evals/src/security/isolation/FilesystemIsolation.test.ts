import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Verifier from "../Verifier.ts"
import { makeConfig, makeTestLayer, observeSource } from "../IsolationTestSupport.ts"
import { provideLayer } from "../../TestLayers.ts"

it.effect("denies filesystem builtins and writes to the candidate workspace", () => {
  const config = makeConfig(
    `io.better-native.dx-evals.conformance=write-${process.pid}-${Date.now()}`,
  )
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { observation, workspace } = yield* observeSource(`
import { writeFileSync } from "node:fs"
import * as Effect from "effect/Effect"

export const candidate = Effect.sync(() => {
  try {
    writeFileSync("/workspace/forbidden.txt", "write-allowed")
    return "write-allowed"
  } catch {
    return "write-denied"
  }
})
`)
    assert.strictEqual(observation.exitCode, 0)
    assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
      schemaVersion: 1,
      kind: "effect-failure",
      failureCategory: "module-load",
    })
    assert.isFalse(yield* fs.exists(`${workspace}/forbidden.txt`))
  }).pipe(provideLayer(makeTestLayer(config)))
})
