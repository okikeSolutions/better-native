import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { RunId, TestCaseId, TestSourceId } from "../Domain.ts"
import * as ExternalRunProtocol from "./ExternalRunProtocol.ts"
import {
  jestCaseName,
  parseJest,
  parseJunit,
  parseXcTest,
  RunnerOutputError,
} from "./ExternalRunnerAdapters.ts"

const runId = RunId.make("run-1")
const sourceId = TestSourceId.make("suite#source")

describe("ExternalRunnerAdapters", () => {
  it.effect("normalizes Jest JSON", () =>
    parseJest(
      runId,
      sourceId,
      JSON.stringify({
        testResults: [
          {
            assertionResults: [
              {
                fullName: "suite nested passes",
                ancestorTitles: ["suite", "nested"],
                title: "passes",
                status: "passed",
                duration: 12,
                failureMessages: [],
              },
            ],
          },
        ],
      }),
    ).pipe(
      Effect.flatMap((results) =>
        ExternalRunProtocol.validate(
          {
            sourceId,
            staticCaseIds: [TestCaseId.make(`${sourceId}#suite > nested > passes@1`)],
          },
          results,
        ),
      ),
      Effect.map((results) => {
        assert.strictEqual(results.length, 1)
        assert.strictEqual(results[0]?.caseId, `${sourceId}#suite > nested > passes@1`)
        assert.strictEqual(results[0]?.outcome._tag, "passed")
      }),
    ),
  )

  it("maps every generated nested hierarchy back to its exact catalog spelling", () => {
    const name = "outer > inner > passes"
    assert.strictEqual(
      jestCaseName({
        fullName: "outer inner passes",
        ancestorTitles: ["outer", "inner"],
        title: "passes",
      }),
      name,
    )
  })

  it.effect("normalizes Gradle and Maestro JUnit XML", () =>
    parseJunit(
      "gradle-unit",
      runId,
      sourceId,
      '<testsuites><testsuite name="outer"><testsuite name="inner"><testcase classname="test" name="passes" time="0.25"/><testcase classname="test" name="fails"><failure>boom</failure></testcase></testsuite></testsuite></testsuites>',
    ).pipe(
      Effect.flatMap((results) =>
        ExternalRunProtocol.validate(
          {
            sourceId,
            staticCaseIds: [
              TestCaseId.make(`${sourceId}#outer > inner > passes@1`),
              TestCaseId.make(`${sourceId}#outer > inner > fails@1`),
            ],
          },
          results.map((result) =>
            result.outcome._tag === "failed"
              ? { ...result, outcome: { _tag: "passed" as const, durationMillis: 0 } }
              : result,
          ),
        ).pipe(Effect.as(results)),
      ),
      Effect.map((results) => {
        assert.deepEqual(
          results.map(({ outcome }) => outcome._tag),
          ["passed", "failed"],
        )
        assert.strictEqual(results[0]?.caseId, `${sourceId}#outer > inner > passes@1`)
      }),
    ),
  )

  it.effect("normalizes xcresulttool JSON", () =>
    parseXcTest(
      runId,
      sourceId,
      JSON.stringify({
        name: "root",
        children: [{ name: "testExample()", result: "Success", duration: 0.1 }],
      }),
    ).pipe(
      Effect.map((results) => {
        assert.strictEqual(results[0]?.outcome._tag, "passed")
      }),
    ),
  )

  it.effect("rejects malformed external output", () =>
    parseJest(runId, sourceId, "not-json").pipe(
      Effect.flip,
      Effect.map((failure) => assert.instanceOf(failure, RunnerOutputError)),
    ),
  )
})
