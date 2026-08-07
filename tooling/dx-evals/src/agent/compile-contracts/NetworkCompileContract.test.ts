import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { assertReferenceCompiles, liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as Network from "../../tasks/Network.ts"

it.effect("compiles the Network reference solution", () =>
  Effect.gen(function* () {
    yield* assertReferenceCompiles(yield* Network.load)
  }).pipe(provideLayer(liveLayer)),
)
