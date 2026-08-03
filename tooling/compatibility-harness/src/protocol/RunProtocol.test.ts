import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { BuildId, RunId, TestCaseId, TestSourceId, type AppRunSummary } from "../Domain.ts"
import { infrastructureOf, RunProtocolError, validate } from "./RunProtocol.ts"

const caseWithComma = TestCaseId.make("suite#source#accepts red, green, blue@1")
const expected = {
  runId: "run-1",
  buildId: "build-1",
  mode: "candidate" as const,
  caseIds: [caseWithComma],
}
const summary = (caseIds: ReadonlyArray<TestCaseId> = [caseWithComma]): AppRunSummary => ({
  schemaVersion: 1,
  runId: RunId.make("run-1"),
  buildId: BuildId.make("build-1"),
  mode: "candidate",
  results: caseIds.map((caseId) => ({
    schemaVersion: 1,
    runId: RunId.make("run-1"),
    caseId,
    attempt: 1,
    outcome: { _tag: "passed", durationMillis: 1 },
    artifacts: [],
  })),
  runtimeDiscoveredCaseIds: [],
})

describe("RunProtocol", () => {
  it.effect("closes the exact requested case set without delimiter assumptions", () =>
    validate(expected, summary()).pipe(
      Effect.map((closed) => assert.strictEqual(closed.results[0]?.caseId, caseWithComma)),
    ),
  )

  it.effect(
    "rejects mode drift, duplicates, missing cases, and cases outside selected sources",
    () =>
      Effect.gen(function* () {
        const invalid = [
          { ...summary(), mode: "upstream" as const },
          { ...summary(), results: [...summary().results, ...summary().results] },
          summary([]),
        ]
        for (const value of invalid) {
          const failure = yield* validate(expected, value).pipe(Effect.flip)
          assert.instanceOf(failure, RunProtocolError)
        }

        const outside = yield* validate(
          {
            ...expected,
            caseIds: [],
            sourceIds: [TestSourceId.make("suite#selected")],
          },
          summary([TestCaseId.make("suite#other#case@1")]),
        ).pipe(Effect.flip)
        assert.instanceOf(outside, RunProtocolError)
      }),
  )

  it.effect("requires every static case while admitting declared runtime discoveries", () => {
    const sourceId = TestSourceId.make("suite#selected")
    const staticCase = TestCaseId.make(`${sourceId}#static@1`)
    const dynamicCase = TestCaseId.make(`${sourceId}#dynamic@1`)
    const complete = {
      ...summary([staticCase, dynamicCase]),
      runtimeDiscoveredCaseIds: [dynamicCase],
    }
    return Effect.gen(function* () {
      const closed = yield* validate(
        { ...expected, caseIds: [staticCase], sourceIds: [sourceId] },
        complete,
      )
      assert.lengthOf(closed.results, 2)

      const missing = yield* validate(
        { ...expected, caseIds: [staticCase], sourceIds: [sourceId] },
        { ...summary([dynamicCase]), runtimeDiscoveredCaseIds: [dynamicCase] },
      ).pipe(Effect.flip)
      assert.match(missing.reason, /missing/)

      const undeclared = yield* validate(
        { ...expected, caseIds: [staticCase], sourceIds: [sourceId] },
        summary([staticCase, dynamicCase]),
      ).pipe(Effect.flip)
      assert.match(undeclared.reason, /unexpected/)
    })
  })

  it("turns every unsuccessful executable outcome into runner infrastructure failure", () => {
    const value = summary()
    const failed: AppRunSummary = {
      ...value,
      results: value.results.map((result) => ({
        ...result,
        outcome: {
          _tag: "failed" as const,
          durationMillis: 1,
          message: "boom",
          stack: null,
        },
      })),
    }
    assert.strictEqual(infrastructureOf(failed)._tag, "runner-failed")
    for (const outcome of [
      { _tag: "timeout" as const, timeoutMillis: 1 },
      { _tag: "crashed" as const, signal: null, exitCode: 1 },
      { _tag: "not-run" as const, reason: "missing" },
    ]) {
      assert.strictEqual(
        infrastructureOf({
          ...value,
          results: value.results.map((result) => ({ ...result, outcome })),
        })._tag,
        "runner-failed",
      )
    }
  })
})
