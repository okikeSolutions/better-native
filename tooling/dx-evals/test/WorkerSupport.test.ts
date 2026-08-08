import { assert, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as WorkerSupport from "../runner/WorkerSupport.ts"

class TrustedWorkerCapability extends Context.Service<TrustedWorkerCapability, string>()(
  "@better-native/dx-evals/test/TrustedWorkerCapability",
) {}

it.effect("does not expose trusted worker services to candidate Effects", () =>
  Effect.gen(function* () {
    const result = yield* WorkerSupport.runCandidateEffect(TrustedWorkerCapability).pipe(
      Effect.provideService(TrustedWorkerCapability, "trusted-secret"),
    )

    assert.isTrue(result.effectIsValid)
    if (result.exit === undefined) throw new Error("expected a candidate exit")
    assert.isTrue(Exit.isFailure(result.exit))
  }),
)
