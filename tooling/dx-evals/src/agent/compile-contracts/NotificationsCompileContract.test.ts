import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { assertReferenceCompiles, liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as Notifications from "../../tasks/Notifications.ts"

it.effect("compiles the Notifications reference solution", () =>
  Effect.gen(function* () {
    yield* assertReferenceCompiles(yield* Notifications.load)
  }).pipe(provideLayer(liveLayer)),
)
