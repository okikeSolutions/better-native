import { it } from "@effect/vitest"
import { assertAdapterOutcome, mainLayer } from "../TrialRunnerTestSupport.ts"
import { provideLayer } from "../TestLayers.ts"

it.effect("broken produces fail", () =>
  assertAdapterOutcome("broken", "fail").pipe(provideLayer(mainLayer)),
)
