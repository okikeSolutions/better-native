import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as CampaignBudget from "./CampaignBudget.ts"
import * as Domain from "../Domain.ts"
import { provideLayer } from "../TestLayers.ts"

describe("paid campaign budget", () => {
  it.effect("reserves conservatively and fails before exceeding the campaign maximum", () =>
    Effect.gen(function* () {
      const budget = yield* CampaignBudget.CampaignBudget
      yield* budget.reserve(Domain.RunId.make("run-1"), 0.6)
      const duplicate = yield* Effect.exit(budget.reserve(Domain.RunId.make("run-1"), 0.6))
      const rejected = yield* Effect.exit(budget.reserve(Domain.RunId.make("run-2"), 0.5))
      const snapshot = yield* budget.snapshot

      assert.strictEqual(duplicate._tag, "Failure")
      assert.strictEqual(rejected._tag, "Failure")
      assert.strictEqual(snapshot.reservedCostUsd, 0.6)
      assert.deepStrictEqual(snapshot.reservations, { "run-1": 0.6 })
    }).pipe(provideLayer(CampaignBudget.layerWithMaximum(1))),
  )

  it.effect("settles a completed reservation to actual cost before the next serialized trial", () =>
    Effect.gen(function* () {
      const budget = yield* CampaignBudget.CampaignBudget
      yield* budget.reserve(Domain.RunId.make("run-1"), 0.6)
      yield* budget.settle(Domain.RunId.make("run-1"), 0.2)
      yield* budget.reserve(Domain.RunId.make("run-2"), 0.5)
      const snapshot = yield* budget.snapshot

      assert.strictEqual(snapshot.reservedCostUsd, 0.7)
      assert.deepStrictEqual(snapshot.reservations, {
        "run-1": 0.2,
        "run-2": 0.5,
      })
    }).pipe(provideLayer(CampaignBudget.layerWithMaximum(1))),
  )
})
