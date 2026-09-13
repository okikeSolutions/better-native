import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { provideLayer } from "../TestLayers.ts"
import { inspect, SupportStatus, validatesSupportInvariant } from "./CapabilityMigrations.ts"

describe("capability migration ledger", () => {
  it.effect("tracks every existing capability end to end", () =>
    Effect.gen(function* () {
      const statuses = yield* inspect(process.cwd())
      assert.strictEqual(statuses.length, 10)
      assert.deepEqual(
        statuses.flatMap((status) =>
          status.checks
            .filter((check) => !check.complete)
            .map((check) => `${status.id}: ${check.name}`),
        ),
        [],
      )
      assert.strictEqual(statuses.filter(({ ownership }) => ownership === "effect").length, 6)
      assert.strictEqual(statuses.filter(({ ownership }) => ownership === "fallback").length, 4)
      assert.strictEqual(
        statuses.filter(({ supportStatus }) => supportStatus === "stable").length,
        6,
      )
      assert.strictEqual(
        statuses.filter(({ supportStatus }) => supportStatus === "experimental").length,
        4,
      )
      assert.strictEqual(
        statuses.every(({ supportInvariantValid }) => supportInvariantValid),
        true,
      )
    }).pipe(provideLayer(NodeServices.layer)),
  )

  it("rejects unknown support states", () => {
    assert.throws(() => Schema.decodeUnknownSync(SupportStatus)("preview"))
  })

  it("allows experimental support without Effect ownership", () => {
    assert.strictEqual(
      validatesSupportInvariant({
        supportStatus: "experimental",
        ownership: "fallback",
        hostEvidenceComplete: true,
      }),
      true,
    )
  })

  it("requires complete host evidence for stable support", () => {
    assert.strictEqual(
      validatesSupportInvariant({
        supportStatus: "stable",
        ownership: "effect",
        hostEvidenceComplete: false,
      }),
      false,
    )
  })

  it("requires Effect ownership for stable support", () => {
    assert.strictEqual(
      validatesSupportInvariant({
        supportStatus: "stable",
        ownership: "fallback",
        hostEvidenceComplete: true,
      }),
      false,
    )
  })
})
