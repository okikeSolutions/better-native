import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as TestConsole from "effect/testing/TestConsole"
import * as Compatibility from "./Compatibility.ts"
import * as Coverage from "./Coverage.ts"
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
        yield* Coverage.report({ json: false })
        yield* Coverage.report({ json: true })

        const output = (yield* TestConsole.logLines).join("\n")
        assert.include(output, "Validated Expo")
        assert.include(output, "Better Native API coverage")
        assert.include(output, '"schemaVersion": 1')
      }).pipe(provideLayer(layer)),
    120_000,
  )
})
