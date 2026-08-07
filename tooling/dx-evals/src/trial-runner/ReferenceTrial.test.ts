import { it } from "@effect/vitest"
import { assertAdapterOutcome, mainLayer } from "../TrialRunnerTestSupport.ts"
import { provideLayer } from "../TestLayers.ts"

it.effect("reference produces pass", () =>
  assertAdapterOutcome("reference", "pass").pipe(provideLayer(mainLayer)),
)
