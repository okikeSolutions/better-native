import { assert, describe, it } from "@effect/vitest"
import { configureUpstreamSelection, metadata, registry } from "./Registry.ts"

describe("generated compatibility registry", () => {
  it("contains the complete corpus without silent omissions", () => {
    assert.isAtLeast(registry.length, 2_000)
    assert.strictEqual(new Set(registry.map(({ sourceId }) => sourceId)).size, registry.length)
    assert.strictEqual(metadata.sources.length, registry.length)
    assert.isTrue(
      registry.every((source) => source.load !== null || source.reason !== null),
      "every external source must explain where it executes",
    )
  })

  it("retains Expo host tooling and BareExpo Maestro flows in the denominator", () => {
    assert.isTrue(registry.some(({ path }) => path.startsWith("tools/") && path.includes(".test.")))
    assert.isTrue(registry.some(({ path }) => path.startsWith("docs/") && path.includes(".test.")))
    assert.isTrue(registry.some(({ path }) => /^apps\/bare-expo\/e2e\/.*\.ya?ml$/.test(path)))
    assert.isTrue(
      registry.some(({ path }) => path === "apps/bare-expo/scripts/lib/e2e-common.test.ts"),
    )
    assert.isTrue(
      registry.some(
        ({ path }) => path === "apps/test-suite/screens/__tests__/getScreenIdForLinking.test.ts",
      ),
    )
    assert.isTrue(registry.some(({ path }) => path.startsWith("apps/router-e2e/__e2e__/")))
    assert.isTrue(registry.some(({ path }) => path.startsWith("packages/expo-updates/e2e/")))
  })

  it("exposes platform-selected Expo Jasmine modules and every static case ID", () => {
    const basic = registry.find(({ path }) => path.endsWith("/tests/Basic.js"))
    const network = registry.find(({ path }) => path.endsWith("/tests/Network.js"))
    assert.isDefined(basic)
    assert.isDefined(network)
    assert.isFunction(basic.load)
    assert.isFunction(network.load)
    assert.isAbove(basic.caseIds.length, 0)
    assert.isAbove(network.caseIds.length, 0)
    assert.strictEqual(
      new Set(registry.flatMap(({ caseIds }) => caseIds)).size,
      registry.reduce((total, source) => total + source.caseIds.length, 0),
    )
  })

  it("keeps TaskManager and Location marked for eager registration", () => {
    const eager = registry.filter(({ registration }) => registration === "eager")
    assert.isTrue(eager.some(({ path }) => /\/tests\/TaskManager\./.test(path)))
    assert.isTrue(eager.some(({ path }) => /\/tests\/Location\./.test(path)))
  })

  it("fails closed until the pinned applicability adapter initializes", () => {
    const authoritative = registry.find(({ authority }) => authority === "upstream-selected")
    assert.isDefined(authoritative)
    assert.throws(
      () => authoritative.selectedByUpstream,
      /applicability was read before app initialization/,
    )
    configureUpstreamSelection(
      metadata.sources.flatMap(({ runtimeName }) => (runtimeName === null ? [] : [runtimeName])),
    )
    assert.isTrue(authoritative.selectedByUpstream)
  })
})
