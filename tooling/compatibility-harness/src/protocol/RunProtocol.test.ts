import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { BuildId, RunId, TestCaseId, TestSourceId, type AppRunSummary } from "../Domain.ts"
import { completedInfrastructure, RunProtocolError, validate } from "./RunProtocol.ts"

const caseWithComma = TestCaseId.make("suite#source#accepts red, green, blue@1")
const expected = {
  runId: "run-1",
  buildId: "build-1",
  mode: "candidate" as const,
  sourceId: TestSourceId.make("suite#source"),
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
  it.effect("closes one selected source without delimiter assumptions", () =>
    validate(expected, summary()).pipe(
      Effect.map((closed) => assert.strictEqual(closed.results[0]?.caseId, caseWithComma)),
    ),
  )

  it.effect(
    "rejects mode drift, duplicates, missing results, and cases outside the selected source",
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
          { ...expected, sourceId: TestSourceId.make("suite#selected") },
          summary([TestCaseId.make("suite#other#case@1")]),
        ).pipe(Effect.flip)
        assert.instanceOf(outside, RunProtocolError)
      }),
  )

  it.effect("admits declared runtime discoveries from the selected source", () => {
    const sourceId = TestSourceId.make("suite#selected")
    const staticCase = TestCaseId.make(`${sourceId}#static@1`)
    const dynamicCase = TestCaseId.make(`${sourceId}#dynamic@1`)
    const complete = {
      ...summary([staticCase, dynamicCase]),
      runtimeDiscoveredCaseIds: [dynamicCase],
    }
    return Effect.gen(function* () {
      const closed = yield* validate({ ...expected, sourceId }, complete)
      assert.lengthOf(closed.results, 2)
    })
  })

  it("represents a completed runner independently from behavioral outcomes", () => {
    assert.deepEqual(completedInfrastructure(), { _tag: "succeeded" })
  })
})
