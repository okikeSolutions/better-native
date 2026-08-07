import { it } from "@effect/vitest"
import { assertAdapterOutcome, mainLayer } from "../TrialRunnerTestSupport.ts"
import { provideLayer } from "../TestLayers.ts"

it.effect("noop produces fail", () =>
  assertAdapterOutcome("noop", "fail").pipe(provideLayer(mainLayer)),
)
