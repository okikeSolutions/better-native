import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { assertReferenceCompiles, liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as KeepAwake from "../../tasks/KeepAwake.ts"

it.effect("compiles the Keep Awake reference solution", () =>
  Effect.gen(function* () {
    yield* assertReferenceCompiles(yield* KeepAwake.load)
  }).pipe(provideLayer(liveLayer)),
)
