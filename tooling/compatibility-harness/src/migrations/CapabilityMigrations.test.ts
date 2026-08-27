import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { provideLayer } from "../TestLayers.ts"
import { inspect } from "./CapabilityMigrations.ts"

describe("capability migration ledger", () => {
  it.effect("tracks every existing capability end to end", () =>
    Effect.gen(function* () {
      const statuses = yield* inspect(process.cwd())
      assert.strictEqual(statuses.length, 9)
      assert.deepEqual(
        statuses.flatMap((status) =>
          status.checks
            .filter((check) => !check.complete)
            .map((check) => `${status.id}: ${check.name}`),
        ),
        [],
      )
      assert.strictEqual(statuses.filter(({ ownership }) => ownership === "effect").length, 4)
      assert.strictEqual(statuses.filter(({ ownership }) => ownership === "fallback").length, 5)
    }).pipe(provideLayer(NodeServices.layer)),
  )
})
