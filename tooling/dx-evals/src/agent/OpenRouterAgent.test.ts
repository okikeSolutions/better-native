import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as OpenRouterAgent from "./OpenRouterAgent.ts"
import * as Campaigns from "../campaign/Campaigns.ts"
import { provideLayer } from "../TestLayers.ts"

const accessLayer = (available: boolean) =>
  Layer.succeed(
    OpenRouterAgent.OpenRouterAccess,
    OpenRouterAgent.OpenRouterAccess.of({ available }),
  )

describe("OpenRouter paid-run preflight", () => {
  it.effect("rejects a paid campaign before subprocess startup when the credential is absent", () =>
    Effect.gen(function* () {
      const missing = yield* OpenRouterAgent.requireCredential.pipe(
        Effect.exit,
        provideLayer(accessLayer(false)),
      )
      assert.strictEqual(missing._tag, "Failure")

      yield* OpenRouterAgent.requireCredential.pipe(provideLayer(accessLayer(true)))
    }),
  )

  it.effect("accepts the reviewed reusable key for a smaller campaign", () =>
    OpenRouterAgent.validateSpendingLimit(0.05, 0.05, 0, {
      limit: 5,
      limitRemaining: 4.72,
    }),
  )

  it.effect("rejects an unlimited or broadly limited key before model execution", () =>
    Effect.gen(function* () {
      const unlimited = yield* Effect.exit(
        OpenRouterAgent.validateSpendingLimit(0.75, 4.5, 0, {
          limit: null,
          limitRemaining: null,
        }),
      )
      const broad = yield* Effect.exit(
        OpenRouterAgent.validateSpendingLimit(0.75, 4.5, 0, {
          limit: Campaigns.reviewedMaximumKeyLimitUsd + 0.01,
          limitRemaining: Campaigns.reviewedMaximumKeyLimitUsd + 0.01,
        }),
      )

      assert.strictEqual(unlimited._tag, "Failure")
      assert.strictEqual(broad._tag, "Failure")
    }),
  )

  it.effect("requires enough remaining provider budget for every unreserved trial", () =>
    Effect.gen(function* () {
      yield* OpenRouterAgent.validateSpendingLimit(0.75, 4.5, 0.75, {
        limit: 4.5,
        limitRemaining: 3.75,
      })
      const insufficient = yield* Effect.exit(
        OpenRouterAgent.validateSpendingLimit(0.75, 4.5, 0.75, {
          limit: 4.5,
          limitRemaining: 3.74,
        }),
      )
      assert.strictEqual(insufficient._tag, "Failure")
    }),
  )
})
