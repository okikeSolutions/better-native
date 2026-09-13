import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import { BuildId, DeviceId, RunId, TestSourceId } from "../Domain.ts"
import { Capability } from "./CapabilityMigrations.ts"
import { obligationsFor, readCapabilityProfileEvidence } from "./CapabilityEvidence.ts"

const capability = Schema.decodeUnknownSync(Capability)({
  id: "task-manager",
  supportStatus: "experimental",
  expoPackage: "expo-task-manager",
  candidatePackage: "@better-native/task-manager",
  compatibilitySource: "TaskManager.ts",
  expoSubpaths: ["."],
  requirements: {
    platforms: ["web", "ios", "android"],
    dxEval: true,
    events: false,
    hooks: false,
    configPlugin: true,
    backgroundExecution: true,
    physicalDevice: true,
  },
  verification: {
    unitProject: "@better-native/task-manager",
    coverageScope: "packages/task-manager/src/**/*.ts",
    integrationSuites: ["published", "eval-controls"],
    parityPlatforms: ["web", "ios", "android"],
  },
})

const sourceId = TestSourceId.make(
  "better-native-capability#apps/compatibility-suite/src/capabilities/TaskManager.ts",
)

const writeComparison = (
  root: string,
  id: string,
  platform: "web" | "ios" | "android",
  kind: "browser" | "simulator" | "emulator" | "physical",
  candidateRevision = "candidate-1",
): void => {
  const directory = join(root, ".artifacts", "comparisons", id)
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, "record.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceIds: [sourceId],
        platform,
        device: {
          id: DeviceId.make(`${platform}-${kind}`),
          platform,
          kind,
          name: `${platform} ${kind}`,
          osVersion: null,
          runtimeVersion: null,
        },
        expoRevision: "expo-1",
        candidateRevision,
        upstreamBuildIds: [BuildId.make(`${id}-upstream-build`)],
        candidateBuildIds: [BuildId.make(`${id}-candidate-build`)],
        upstreamRunIds: [RunId.make(`${id}-upstream-run`)],
        candidateRunIds: [RunId.make(`${id}-candidate-run`)],
        verdict: { cases: 3, matches: 3, expectedDivergences: 0, issues: [] },
      },
      null,
      2,
    )}\n`,
  )
}

describe("capability retained evidence", () => {
  it("adds physical native obligations only to promotion", () => {
    assert.deepEqual(obligationsFor(capability, "integration"), [
      { platform: "web", deviceKind: "browser" },
      { platform: "ios", deviceKind: "simulator" },
      { platform: "android", deviceKind: "emulator" },
    ])
    assert.deepEqual(obligationsFor(capability, "promotion").slice(3), [
      { platform: "ios", deviceKind: "physical" },
      { platform: "android", deviceKind: "physical" },
    ])
  })

  it("verifies integration from current retained comparisons", () => {
    const root = mkdtempSync(join(tmpdir(), "better-native-profile-evidence-"))
    writeComparison(root, "web", "web", "browser")
    writeComparison(root, "ios", "ios", "simulator")
    writeComparison(root, "android", "android", "emulator")
    const result = readCapabilityProfileEvidence(
      { repositoryRoot: root, candidateRevision: "candidate-1", expoRevision: "expo-1" },
      capability,
      "integration",
    )
    assert.isTrue(result.verified)
    assert.deepEqual(
      result.obligations.map(({ status }) => status),
      ["verified", "verified", "verified"],
    )
  })

  it("fails closed for stale and missing promotion evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "better-native-profile-evidence-"))
    writeComparison(root, "web", "web", "browser", "candidate-old")
    writeComparison(root, "ios", "ios", "simulator")
    writeComparison(root, "android", "android", "emulator")
    const result = readCapabilityProfileEvidence(
      { repositoryRoot: root, candidateRevision: "candidate-1", expoRevision: "expo-1" },
      capability,
      "promotion",
    )
    assert.isFalse(result.verified)
    assert.strictEqual(result.obligations[0]?.status, "stale")
    assert.deepEqual(
      result.obligations.slice(3).map(({ status }) => status),
      ["missing", "missing"],
    )
  })
})
