import { assert, describe, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import {
  configureUpstreamSelection,
  interactiveSmokeSourceIds,
  metadata,
  registry,
} from "./Registry.ts"

describe("generated compatibility registry", () => {
  it("keeps the complete audit ledger while bundling only app-runnable sources", () => {
    const complete = JSON.parse(
      readFileSync(new URL("./generated/RegistryMetadata.json", import.meta.url), "utf8"),
    ) as { readonly sources: ReadonlyArray<{ readonly sourceId: string }> }
    assert.isAtLeast(complete.sources.length, 2_000)
    assert.isBelow(registry.length, complete.sources.length)
    assert.strictEqual(new Set(registry.map(({ sourceId }) => sourceId)).size, registry.length)
    assert.strictEqual(metadata.sources.length, registry.length)
    assert.isTrue(
      registry.every((source) => source.load !== null),
      "every bundled runtime source must have a platform loader",
    )
  })

  it("keeps each platform runtime registry within the checked-in bundle budget", () => {
    const budgets = JSON.parse(
      readFileSync(
        new URL("../../../compatibility/release-build-budgets.json", import.meta.url),
        "utf8",
      ),
    ) as { readonly runtimeRegistryMaxBytes: number }
    for (const platform of ["web", "ios", "android"]) {
      const bytes = readFileSync(
        new URL(`./generated/RuntimeRegistryMetadata.${platform}.ts`, import.meta.url),
      ).byteLength
      assert.isAtMost(bytes, budgets.runtimeRegistryMaxBytes, platform)
    }
  })

  it("does not bundle externally executed host and Maestro sources", () => {
    assert.isFalse(registry.some(({ path }) => path.startsWith("tools/")))
    assert.isFalse(registry.some(({ path }) => path.startsWith("docs/")))
    assert.isFalse(registry.some(({ path }) => /^apps\/bare-expo\/e2e\/.*\.ya?ml$/.test(path)))
  })

  it("exposes platform-selected Expo Jasmine modules and every static case ID", () => {
    const basic = registry.find(({ path }) => path.endsWith("/tests/Basic.js"))
    const battery = registry.find(({ path }) => path.endsWith("/tests/Battery.js"))
    const keepAwake = registry.find(({ path }) => path.endsWith("/tests/KeepAwake.js"))
    const network = registry.find(({ path }) => path.endsWith("/tests/Network.js"))
    const secureStore = registry.find(({ path }) => path.endsWith("/tests/SecureStore.js"))
    const sqlite = registry.find(({ path }) => path.endsWith("/tests/SQLite.ts"))
    assert.isDefined(basic)
    assert.isDefined(battery)
    assert.isDefined(keepAwake)
    assert.isDefined(network)
    assert.isDefined(secureStore)
    assert.isDefined(sqlite)
    assert.isFunction(basic.load)
    assert.isFunction(battery.load)
    assert.isFunction(keepAwake.load)
    assert.isFunction(network.load)
    assert.isFunction(secureStore.load)
    assert.isFunction(sqlite.load)
    assert.isAbove(basic.caseIds.length, 0)
    assert.isAbove(battery.caseIds.length, 0)
    assert.isAbove(keepAwake.caseIds.length, 0)
    assert.isAbove(network.caseIds.length, 0)
    assert.isAbove(secureStore.caseIds.length, 0)
    assert.isAbove(sqlite.caseIds.length, 0)
    assert.strictEqual(
      new Set(registry.flatMap(({ caseIds }) => caseIds)).size,
      registry.reduce((total, source) => total + source.caseIds.length, 0),
    )
  })

  it("includes the reviewed capabilities in the interactive smoke cohort", () => {
    const smokePaths = registry
      .filter(({ sourceId }) => interactiveSmokeSourceIds.has(sourceId))
      .map(({ path }) => path)
    assert.deepEqual(smokePaths, [
      "apps/test-suite/tests/Basic.js",
      "apps/test-suite/tests/Battery.js",
      "apps/test-suite/tests/KeepAwake.js",
      "apps/test-suite/tests/Network.js",
      "apps/test-suite/tests/SecureStore.js",
      "apps/test-suite/tests/SQLite.ts",
    ])
  })

  it("keeps module-scope APIs marked and generated for eager registration", () => {
    const eager = registry.filter(({ registration }) => registration === "eager")
    assert.isTrue(eager.some(({ path }) => /\/tests\/TaskManager\./.test(path)))
    assert.isTrue(eager.some(({ path }) => /\/tests\/Location\./.test(path)))
    assert.isTrue(eager.some(({ path }) => path.endsWith("/capabilities/Notifications.ts")))
    for (const platform of ["web", "ios", "android"]) {
      const generated = readFileSync(
        new URL(`./generated/EagerRegistrations.${platform}.ts`, import.meta.url),
        "utf8",
      )
      assert.include(generated, 'require("../capabilities/Notifications.ts")')
      assert.include(
        generated,
        "better-native-capability#apps/compatibility-suite/src/capabilities/Notifications.ts",
      )
    }
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

  it("allows supplemental sources without upstream applicability", () => {
    const supplemental = registry.find(
      ({ sourceId }) =>
        sourceId ===
        "better-native-capability#apps/compatibility-suite/src/capabilities/KeepAwake.ts",
    )
    assert.isDefined(supplemental)
    assert.deepEqual(supplemental.platforms, ["web", "ios", "android"])
    assert.lengthOf(supplemental.caseIds, 7)
    for (const behavior of [
      "mounts and unmounts the hook",
      "manages listener subscriptions",
      "emits release events",
      "preserves platform errors",
      "isolates concurrent tags",
    ]) {
      assert.isTrue(
        supplemental.caseIds.some((caseId) => caseId.includes(behavior)),
        behavior,
      )
    }
    configureUpstreamSelection([])
    assert.isTrue(supplemental.selectedByUpstream)
  })

  it("registers reviewed Network and Battery Effect capability sources", () => {
    const expected = [
      {
        sourceId: "better-native-capability#apps/compatibility-suite/src/capabilities/Network.ts",
        cases: 5,
        behaviors: [
          "current native state",
          "native IPv4 address",
          "typed native unavailability",
          "native state stream",
          "live network atom",
        ],
      },
      {
        sourceId: "better-native-capability#apps/compatibility-suite/src/capabilities/Battery.ts",
        cases: 4,
        behaviors: [
          "native battery capabilities",
          "combined native power state",
          "native battery streams",
          "live battery atoms",
        ],
      },
    ] as const
    for (const entry of expected) {
      const supplemental = registry.find(({ sourceId }) => sourceId === entry.sourceId)
      assert.isDefined(supplemental)
      assert.deepEqual(supplemental.platforms, ["web", "ios", "android"])
      assert.lengthOf(supplemental.caseIds, entry.cases)
      for (const behavior of entry.behaviors) {
        assert.isTrue(
          supplemental.caseIds.some((caseId) => caseId.includes(behavior)),
          behavior,
        )
      }
      configureUpstreamSelection([])
      assert.isTrue(supplemental.selectedByUpstream)
    }
  })

  it("registers the web-only SecureStore capability with reviewed cases", () => {
    const supplemental = registry.find(
      ({ sourceId }) =>
        sourceId ===
        "better-native-capability#apps/compatibility-suite/src/capabilities/SecureStore.web.ts",
    )
    assert.isDefined(supplemental)
    assert.deepEqual(supplemental.platforms, ["web"])
    assert.lengthOf(supplemental.caseIds, 3)
    for (const behavior of [
      "actual Expo web implementation as unavailable",
      "unsupported asynchronous web operations",
      "unsupported synchronous web operations",
    ]) {
      assert.isTrue(
        supplemental.caseIds.some((caseId) => caseId.includes(behavior)),
        behavior,
      )
    }
    configureUpstreamSelection([])
    assert.isTrue(supplemental.selectedByUpstream)
  })

  it("records reviewed native SecureStore capability sources in the full ledger", () => {
    const complete = JSON.parse(
      readFileSync(new URL("./generated/RegistryMetadata.json", import.meta.url), "utf8"),
    ) as typeof metadata
    const core = complete.sources.find(
      ({ sourceId }) =>
        sourceId ===
        "better-native-capability#apps/compatibility-suite/src/capabilities/SecureStore.ts",
    )
    const nativeFailure = complete.sources.find(
      ({ sourceId }) =>
        sourceId ===
        "better-native-capability#apps/compatibility-suite/src/capabilities/SecureStoreNativeFailure.ios.ts",
    )
    assert.isDefined(core)
    assert.deepEqual(core.platforms, ["ios", "android"])
    assert.lengthOf(core.caseIds, 5)
    assert.isDefined(nativeFailure)
    assert.deepEqual(nativeFailure.platforms, ["ios"])
    assert.lengthOf(nativeFailure.caseIds, 1)
  })
})
