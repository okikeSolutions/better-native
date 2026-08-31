import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { assertReferenceCompiles, liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as Sqlite from "../../tasks/Sqlite.ts"

it.effect("compiles the SQLite reference solution", () =>
  Effect.gen(function* () {
    yield* assertReferenceCompiles(yield* Sqlite.load)
  }).pipe(provideLayer(liveLayer)),
)
