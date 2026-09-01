import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { assertReferenceCompiles, liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as BackgroundTask from "../../tasks/BackgroundTask.ts"

it.effect("compiles the Background Task reference solution", () =>
  Effect.gen(function* () {
    yield* assertReferenceCompiles(yield* BackgroundTask.load)
  }).pipe(provideLayer(liveLayer)),
)
