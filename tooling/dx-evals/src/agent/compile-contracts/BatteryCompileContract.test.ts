import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { assertReferenceCompiles, liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as Battery from "../../tasks/Battery.ts"

it.effect("compiles the Battery reference solution", () =>
  Effect.gen(function* () {
    yield* assertReferenceCompiles(yield* Battery.load)
  }).pipe(provideLayer(liveLayer)),
)
