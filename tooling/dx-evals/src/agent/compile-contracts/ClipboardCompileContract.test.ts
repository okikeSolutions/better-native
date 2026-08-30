import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { assertReferenceCompiles, liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as Clipboard from "../../tasks/Clipboard.ts"

it.effect("compiles the Clipboard reference solution", () =>
  Effect.gen(function* () {
    yield* assertReferenceCompiles(yield* Clipboard.load)
  }).pipe(provideLayer(liveLayer)),
)
