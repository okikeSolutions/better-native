import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import { BuildId, DeviceId, RunId, TestSourceId } from "../Domain.ts"
import { Capability } from "./CapabilityMigrations.ts"
import { replayIntegrationEvidence } from "./CapabilityReplay.ts"

const capability = Schema.decodeUnknownSync(Capability)({
  id: "network",
  supportStatus: "experimental",
  expoPackage: "expo-network",
  candidatePackage: "@better-native/network",
  compatibilitySource: "Network.ts",
  expoSubpaths: ["."],
  requirements: {
    platforms: ["web", "ios", "android"],
    dxEval: true,
    events: false,
    hooks: false,
    configPlugin: false,
    backgroundExecution: false,
    physicalDevice: true,
  },
  verification: {
    unitProject: "@better-native/network",
    coverageScope: "packages/network/src/**/*.ts",
    integrationSuites: ["published"],
    parityPlatforms: ["web", "ios", "android"],
  },
})

const writeRecord = (
  root: string,
  platform: "web" | "ios" | "android",
  kind: "browser" | "simulator" | "emulator" | "physical",
  candidateRevision = "subject-1",
): void => {
  const directory = join(root, platform)
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, "record.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      sourceIds: [
        TestSourceId.make(
          "better-native-capability#apps/compatibility-suite/src/capabilities/Network.ts",
        ),
      ],
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
      upstreamBuildIds: [BuildId.make(`${platform}-upstream-build`)],
      candidateBuildIds: [BuildId.make(`${platform}-candidate-build`)],
      upstreamRunIds: [RunId.make(`${platform}-upstream-run`)],
      candidateRunIds: [RunId.make(`${platform}-candidate-run`)],
      verdict: { cases: 2, matches: 2, expectedDivergences: 0, issues: [] },
    })}\n`,
  )
}

const completeBundle = (): string => {
  const root = mkdtempSync(join(tmpdir(), "better-native-replay-"))
  writeRecord(root, "web", "browser")
  writeRecord(root, "ios", "simulator")
  writeRecord(root, "android", "emulator")
  return root
}

describe("capability integration replay", () => {
  it("uses the artifact subject revision independently of evaluator HEAD", () => {
    const root = completeBundle()
    const replay = replayIntegrationEvidence({
      repositoryRoot: root,
      evidenceRoot: root,
      capabilities: [capability],
      expectedExpoRevision: "expo-1",
      expectedCandidateRevision: "subject-1",
    })
    assert.strictEqual(replay.candidateRevision, "subject-1")
    assert.strictEqual(replay.capabilities[0]?.verified, true)
  })

  it("rejects mixed subject revisions", () => {
    const root = completeBundle()
    writeRecord(root, "android", "emulator", "subject-2")
    assert.throws(
      () =>
        replayIntegrationEvidence({
          repositoryRoot: root,
          evidenceRoot: root,
          capabilities: [capability],
          expectedExpoRevision: "expo-1",
        }),
      /mixes candidate revisions/,
    )
  })

  it("keeps physical-device records outside integration replay", () => {
    const root = completeBundle()
    writeRecord(root, "ios", "physical")
    assert.throws(
      () =>
        replayIntegrationEvidence({
          repositoryRoot: root,
          evidenceRoot: root,
          capabilities: [capability],
          expectedExpoRevision: "expo-1",
        }),
      /accepts only web\/browser, ios\/simulator, and android\/emulator/,
    )
  })
})
