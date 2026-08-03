import * as BunServices from "@effect/platform-bun/BunServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ExpoRepository from "../ExpoRepository.ts"
import * as Suites from "./Suites.ts"
import { jestCaseName } from "../supervision/ExternalRunnerAdapters.ts"

describe("Suites", () => {
  it.effect(
    "assigns every source to a concrete adapter or an explained non-executable runner",
    () =>
      Effect.gen(function* () {
        const corpus = yield* Suites.discover()
        assert.ok(corpus.sources.length > 1_900)
        assert.strictEqual(
          corpus.sources.filter(
            ({ executability, reason }) => executability === "non-executable" && reason === null,
          ).length,
          0,
        )
        assert.strictEqual(
          corpus.sources.some(({ runner }) => (runner as string) === "e2e"),
          false,
        )
        assert.ok(corpus.sources.some(({ runner }) => runner === "playwright"))
        assert.ok(corpus.sources.some(({ runner }) => runner === "detox"))
        assert.ok(corpus.sources.some(({ runner }) => runner === "bun-test"))
        const javascriptE2e = corpus.sources.filter(({ suiteId }) => suiteId === "javascript-e2e")
        assert.isAbove(javascriptE2e.length, 0)
        assert.isTrue(
          javascriptE2e.every(
            ({ executability, reason }) =>
              executability === "runtime-discovery-required" && reason !== null,
          ),
        )
        assert.isFalse(
          corpus.sources.some(
            ({ suiteId, path }) =>
              suiteId === "package-unit" && /(?:\/__e2e__\/|\/e2e\/)/.test(path),
          ),
        )
        assert.strictEqual(
          corpus.sources.find(
            ({ path }) => path === "packages/@expo/cli/e2e/__tests__/export-dom-test.ts",
          )?.suiteId,
          "javascript-e2e",
        )
        const evidenceFor = (path: string) =>
          corpus.sources.find((source) => source.path === path)?.caseEvidence
        assert.strictEqual(
          evidenceFor("packages/@expo/cli/metro-require/__tests__/MetroFastRefreshMockRuntime.ts"),
          "none",
        )
        assert.strictEqual(
          evidenceFor("packages/@expo/cli/src/api/__tests__/getExpoSchema-test.ts"),
          "dynamic",
        )
        assert.strictEqual(
          evidenceFor(
            "packages/expo-modules-autolinking/src/dependencies/__tests__/scanning-test.ts",
          ),
          "dynamic",
        )
        assert.strictEqual(evidenceFor("packages/expo-gl/src/__tests__/GLView-test.tsx"), "static")
        for (const expoModule of ["Basic.js", "Network.js"]) {
          const source = corpus.sources.find(
            ({ path }) => path === `apps/test-suite/tests/${expoModule}`,
          )
          assert.isDefined(source)
          assert.strictEqual(source.runner, "expo-jasmine")
          assert.isAbove(
            corpus.cases.filter(({ sourceId }) => sourceId === source.id).length,
            0,
            `${expoModule} must retain the cases registered by its invoked test factory`,
          )
        }
        const nested = corpus.cases.filter(({ name }) => name.includes(" > "))
        assert.isAtLeast(nested.length, 4_986)
        assert.isTrue(
          nested.every(({ name }) => {
            const parts = name.split(" > ")
            const title = parts.pop()
            return (
              title !== undefined &&
              jestCaseName({
                fullName: [...parts, title].join(" "),
                ancestorTitles: parts,
                title,
              }) === name
            )
          }),
        )
      }).pipe(
        Effect.provide(
          ExpoRepository.layer(process.cwd()).pipe(Layer.provideMerge(BunServices.layer)),
        ),
      ),
  )
})
