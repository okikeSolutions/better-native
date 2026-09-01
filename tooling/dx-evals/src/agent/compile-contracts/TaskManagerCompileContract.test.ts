import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { assertReferenceCompiles, liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as TaskManager from "../../tasks/TaskManager.ts"

it.effect("compiles the Task Manager reference solution", () =>
  Effect.gen(function* () {
    yield* assertReferenceCompiles(yield* TaskManager.load)
  }).pipe(provideLayer(liveLayer)),
)
