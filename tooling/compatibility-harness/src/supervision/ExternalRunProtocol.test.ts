import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { RunId, TestCaseId, TestSourceId, type CaseResult } from "../Domain.ts"
import { ExternalRunProtocolError, validate } from "./ExternalRunProtocol.ts"

const sourceId = TestSourceId.make("package-unit#packages/example/test.ts")
const staticCase = TestCaseId.make(`${sourceId}#static@1`)
const result = (
  caseId: TestCaseId,
  outcome: CaseResult["outcome"] = { _tag: "passed", durationMillis: 1 },
): CaseResult => ({
  schemaVersion: 1,
  runId: RunId.make("external-run"),
  caseId,
  attempt: 1,
  outcome,
  artifacts: [],
})

describe("ExternalRunProtocol", () => {
  it.effect("accepts complete static coverage and additional runtime cases", () =>
    validate({ sourceId, staticCaseIds: [staticCase] }, [
      result(staticCase),
      result(TestCaseId.make(`${sourceId}#dynamic@1`)),
    ]).pipe(Effect.map((results) => assert.lengthOf(results, 2))),
  )

  it.effect("rejects empty, missing, outside, duplicate, and failed results", () =>
    Effect.gen(function* () {
      const invalid: ReadonlyArray<ReadonlyArray<CaseResult>> = [
        [],
        [result(TestCaseId.make(`${sourceId}#other@1`))],
        [result(staticCase), result(TestCaseId.make("package-unit#outside#case@1"))],
        [result(staticCase), result(staticCase)],
        [
          result(staticCase, {
            _tag: "failed",
            durationMillis: 1,
            message: "boom",
            stack: null,
          }),
        ],
      ]
      for (const results of invalid) {
        const failure = yield* validate({ sourceId, staticCaseIds: [staticCase] }, results).pipe(
          Effect.flip,
        )
        assert.instanceOf(failure, ExternalRunProtocolError)
      }
    }),
  )
})
