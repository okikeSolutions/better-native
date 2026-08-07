import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { assertReferenceCompiles, liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as SecureStore from "../../tasks/SecureStore.ts"

it.effect("compiles the Secure Store reference solution", () =>
  Effect.gen(function* () {
    yield* assertReferenceCompiles(yield* SecureStore.load)
  }).pipe(provideLayer(liveLayer)),
)
