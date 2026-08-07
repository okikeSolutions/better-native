import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ExpoRepository from "../ExpoRepository.ts"
import { provideLayer } from "../TestLayers.ts"
import * as HarnessConfig from "../HarnessConfig.ts"
import * as RunnerPlans from "./RunnerPlans.ts"
import * as AppRegistry from "./AppRegistry.ts"
import * as Suites from "../suites/Suites.ts"

describe("generated runner plan ledger", () => {
  it.effect("covers every non-app source with a command or reviewed blocker", () =>
    Effect.gen(function* () {
      const corpus = yield* Suites.discover()
      const metadata = yield* AppRegistry.loadMetadata()
      const app = new Set(
        metadata.sources
          .filter(({ registration }) => registration !== "external")
          .map(({ sourceId }) => sourceId),
      )
      const ledger = RunnerPlans.make(corpus, app)
      const corpusAppSources = corpus.sources.filter(({ id }) => app.has(id))
      assert.strictEqual(ledger.entries.length + corpusAppSources.length, corpus.sources.length)
      assert.deepEqual(RunnerPlans.issues(corpus, ledger, app), [])
      assert.isTrue(
        ledger.entries.every((entry) =>
          entry.status === "executable" ? entry.command !== null : Boolean(entry.reason),
        ),
      )
    }).pipe(
      provideLayer(
        ExpoRepository.layer(process.cwd()).pipe(
          Layer.provideMerge(
            Layer.merge(
              NodeServices.layer,
              HarnessConfig.layer(process.cwd()).pipe(Layer.provide(NodeServices.layer)),
            ),
          ),
        ),
      ),
    ),
  )

  it.effect("emits runner-specific plans and explicit native blockers", () =>
    Effect.gen(function* () {
      const corpus = yield* Suites.discover()
      const metadata = yield* AppRegistry.loadMetadata()
      const app = new Set(
        metadata.sources
          .filter(({ registration }) => registration !== "external")
          .map(({ sourceId }) => sourceId),
      )
      const ledger = RunnerPlans.make(corpus, app)
      const byRunner = (runner: string) => ledger.entries.filter((entry) => entry.runner === runner)
      for (const runner of ["jest", "node-test", "bun-test"]) {
        const entries = byRunner(runner)
        assert.isAbove(entries.length, 0, `${runner} must be represented`)
        assert.isTrue(
          entries.some(({ status }) => status === "executable"),
          runner,
        )
      }
      const authoritativeJest = ledger.entries.find(
        ({ path }) => path === "apps/test-suite/screens/__tests__/getScreenIdForLinking.test.ts",
      )
      assert.strictEqual(authoritativeJest?.status, "executable")
      assert.deepEqual(authoritativeJest?.command?.args.slice(0, 2), ["test", "--"])
      const planFor = (path: string) => ledger.entries.find((entry) => entry.path === path)
      const helper = planFor(
        "packages/@expo/cli/metro-require/__tests__/MetroFastRefreshMockRuntime.ts",
      )
      assert.strictEqual(helper?.status, "blocked")
      assert.match(helper?.reason ?? "", /support input/)
      for (const dynamicTest of [
        "packages/@expo/cli/src/api/__tests__/getExpoSchema-test.ts",
        "packages/expo-modules-autolinking/src/dependencies/__tests__/scanning-test.ts",
      ]) {
        assert.strictEqual(planFor(dynamicTest)?.status, "executable", dynamicTest)
      }
      assert.isTrue(
        ledger.entries
          .filter(
            ({ runner, executability }) =>
              runner === "jest" && executability !== "runtime-discovery-required",
          )
          .every(
            ({ status, sourceId }) =>
              status === "blocked" ||
              corpus.sources.find((source) => source.id === sourceId)?.caseEvidence !== "none",
          ),
        "zero-evidence Jest support sources must fail closed",
      )
      for (const owner of [
        "docs/",
        "packages/html-elements/",
        "packages/expo-type-information/",
        "apps/bare-expo/",
        "packages/expo-audio/",
      ]) {
        const entries = ledger.entries.filter(
          ({ path, runner }) => runner === "jest" && path.startsWith(owner),
        )
        assert.isAbove(entries.length, 0, `${owner} must be represented`)
        assert.isTrue(
          entries.every(({ status, reason }) => status === "blocked" && Boolean(reason)),
          `${owner} must preserve its authoritative workspace test contract as a blocker`,
        )
      }
      for (const runner of [
        "xctest",
        "gradle-unit",
        "gradle-instrumentation",
        "detox",
        "maestro",
        "playwright",
      ]) {
        const entries = byRunner(runner)
        assert.isAbove(entries.length, 0, `${runner} must be represented`)
        assert.isTrue(
          entries.every(({ status, reason }) => status === "blocked" && Boolean(reason)),
        )
      }
      assert.isTrue(
        ledger.entries
          .filter(({ status }) => status === "executable")
          .every(({ path }) => /\.(?:js|jsx|ts|tsx)$/.test(path)),
        "only JavaScript or TypeScript entrypoints may receive host command plans",
      )
      assert.isTrue(
        ledger.entries
          .filter(({ path }) => path.includes("/__tests__/tools/"))
          .every(({ status }) => status === "blocked"),
        "lint subjects and test helpers remain inputs rather than executable plans",
      )
    }).pipe(
      provideLayer(
        ExpoRepository.layer(process.cwd()).pipe(
          Layer.provideMerge(
            Layer.merge(
              NodeServices.layer,
              HarnessConfig.layer(process.cwd()).pipe(Layer.provide(NodeServices.layer)),
            ),
          ),
        ),
      ),
    ),
  )
})
