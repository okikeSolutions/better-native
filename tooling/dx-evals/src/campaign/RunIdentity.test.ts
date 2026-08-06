import * as NodeCrypto from "@effect/platform-node/NodeCrypto"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Domain from "../Domain.ts"
import * as RunIdentity from "./RunIdentity.ts"
import { provideLayer } from "../TestLayers.ts"

describe("trial run identities", () => {
  it("constructs distinct valid default campaign identities", () => {
    const first = RunIdentity.makeDefaultCampaignId(
      1_785_974_400_000,
      "00000000-0000-4000-8000-000000000001",
    )
    const second = RunIdentity.makeDefaultCampaignId(
      1_785_974_400_000,
      "00000000-0000-4000-8000-000000000002",
    )

    assert.notStrictEqual(first, second)
    assert.isTrue(Schema.is(Domain.RunId)(first))
    assert.isTrue(Schema.is(Domain.RunId)(second))
  })

  it.effect("hashes the complete campaign identity without lossy prefix truncation", () =>
    Effect.gen(function* () {
      const common = "campaign-".repeat(20)
      const first = yield* RunIdentity.makeTrialRunId(`${common}first`, "network-reference-1")
      const second = yield* RunIdentity.makeTrialRunId(`${common}second`, "network-reference-1")
      const repeated = yield* RunIdentity.makeTrialRunId(`${common}first`, "network-reference-1")

      assert.notStrictEqual(first, second)
      assert.strictEqual(first, repeated)
      assert.isTrue(Schema.is(Domain.RunId)(first))
      assert.isAtMost(first.length, 128)
    }).pipe(provideLayer(NodeCrypto.layer)),
  )
})
