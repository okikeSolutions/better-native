import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Domain from "./Domain.ts"

const validInput = {
  schemaVersion: 1,
  runId: "foundation-reference-1",
  taskId: "foundation",
  taskVersion: "1",
  adapterId: "reference",
} as const

describe("DX eval domain", () => {
  it("centralizes shared scalar refinements", () => {
    assert.isTrue(Schema.is(Domain.NonEmptyString)("value"))
    assert.isFalse(Schema.is(Domain.NonEmptyString)(""))
    assert.isTrue(Schema.is(Domain.PositiveInteger)(1))
    assert.isFalse(Schema.is(Domain.PositiveInteger)(0))
    assert.isFalse(Schema.is(Domain.PositiveInteger)(1.5))
    assert.isTrue(Schema.is(Domain.NonNegativeInteger)(0))
    assert.isFalse(Schema.is(Domain.NonNegativeInteger)(-1))
    assert.isTrue(Schema.is(Domain.PositiveFinite)(0.01))
    assert.isFalse(Schema.is(Domain.PositiveFinite)(Number.POSITIVE_INFINITY))
  })

  it.effect("decodes a versioned trial input", () =>
    Effect.gen(function* () {
      const decoded = yield* Domain.decodeTrialInput(validInput)
      assert.isTrue(decoded.runId === validInput.runId)
      assert.isTrue(decoded.taskId === validInput.taskId)
      assert.isTrue(decoded.taskVersion === validInput.taskVersion)
      assert.isTrue(decoded.adapterId === validInput.adapterId)
      assert.isTrue(Schema.is(Domain.RunId)(decoded.runId))
      assert.isTrue(Schema.is(Domain.TaskId)(decoded.taskId))
      assert.isTrue(Schema.is(Domain.TaskVersion)(decoded.taskVersion))
      assert.isTrue(Schema.is(Domain.AdapterId)(decoded.adapterId))
    }),
  )

  it.effect("rejects an input without a stable run identity", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Domain.decodeTrialInput({ ...validInput, runId: undefined }),
      )
      assert.strictEqual(result._tag, "Failure")
    }),
  )

  it.effect("rejects a run identity that is unsafe as an artifact path segment", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Domain.decodeTrialInput({ ...validInput, runId: "../escape" }),
      )
      assert.strictEqual(result._tag, "Failure")
    }),
  )
})
