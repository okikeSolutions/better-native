import { assert, describe, it } from "@effect/vitest"
import { BuildId, ContentHash, TestSourceId, type BuildRecord } from "../Domain.ts"
import type { BuildOutput } from "../build/BuildPipeline.ts"
import { make, makeBatch } from "./NativeMaestroFlow.ts"
import type { NativeRunRequest } from "./NativeSupervisor.ts"

const record: BuildRecord = {
  schemaVersion: 1,
  id: BuildId.make("native-build"),
  mode: "upstream",
  platform: "ios",
  expoRevision: "expo-revision",
  candidateRevision: null,
  configurationHash: ContentHash.make("0".repeat(64)),
  bundleHash: ContentHash.make("0".repeat(64)),
  nativeBinaryHash: null,
  artifacts: [],
}
const build: BuildOutput = {
  record,
  workspace: "/workspace",
  appDirectory: "/workspace/app",
  output: "/workspace/App.app",
  expoCli: "/workspace/expo-cli",
  observations: [],
}
const request: NativeRunRequest = {
  id: "ios-source-run",
  build,
  device: { platform: "ios", id: "simulator", applicationId: "dev.betternative.compatibility" },
  unit: {
    id: "ios-expo_network-source",
    runner: "native-app",
    platform: "ios",
    sourceId: TestSourceId.make("expo-app-suite#apps/test-suite/tests/Network.js"),
  },
  permissionState: "granted",
  timeoutMillis: 120_000,
}

describe("NativeMaestroFlow", () => {
  it("uses one short source selection with Expo-style reset and readiness assertions", () => {
    const flow = make(request)
    assert.include(flow, "- clearState")
    assert.include(flow, "- openLink:")
    assert.include(flow, 'id: "compatibility_run"')
    assert.include(flow, 'id: "compatibility_run_complete"')
    assert.include(flow, 'id: "compatibility_run_error"')
    assert.include(flow, "source=expo-app-suite%23apps%2Ftest-suite%2Ftests%2FNetwork.js")
    assert.notInclude(flow, "caseIds")
    assert.notInclude(flow, "case=")
  })

  it("uses one short cohort selector for the pinned Expo native E2E batch", () => {
    const flow = makeBatch(request)
    assert.include(flow, "- clearState")
    assert.include(flow, "cohort=native-e2e")
    assert.notInclude(flow, "source=")
    assert.notInclude(flow, "caseIds")
  })
})
