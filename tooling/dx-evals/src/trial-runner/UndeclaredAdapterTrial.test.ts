import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { runTrial } from "../TrialRunner.ts"
import { mainLayer, syntheticInput } from "../TrialRunnerTestSupport.ts"
import { provideLayer } from "../TestLayers.ts"

it.effect("rejects an undeclared adapter", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      runTrial({
        ...syntheticInput,
        runId: `test-${process.pid}-synthetic-missing-1`,
        adapterId: "missing",
      }),
    )
    assert.strictEqual(result._tag, "Failure")
  }).pipe(provideLayer(mainLayer)),
)
