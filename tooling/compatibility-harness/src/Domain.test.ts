import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import { BuildId, RunId } from "./Domain.ts"

describe("path-bearing IDs", () => {
  it("accepts safe single-segment IDs", () => {
    assert.strictEqual(
      Schema.decodeUnknownSync(BuildId)("build-1.2_3"),
      BuildId.make("build-1.2_3"),
    )
    assert.strictEqual(Schema.decodeUnknownSync(RunId)("run-1.2_3"), RunId.make("run-1.2_3"))
  })

  it("rejects separators and traversal-like IDs", () => {
    for (const value of ["", "../outside", "build/run", "build\\run", ".hidden"]) {
      assert.throws(() => Schema.decodeUnknownSync(BuildId)(value))
      assert.throws(() => Schema.decodeUnknownSync(RunId)(value))
    }
  })
})
