import { assert, describe, it } from "@effect/vitest"
import { BuildId, ContentHash, RunId, TestSourceId, type BuildRecord } from "../Domain.ts"
import type { BuildOutput } from "../build/BuildPipeline.ts"
import { make, makeBatch } from "./NativeMaestroFlow.ts"
import type { NativeBatchRequest, NativeRunRequest } from "./NativeSupervisor.ts"

const record: BuildRecord = {
  schemaVersion: 2,
  id: BuildId.make("native-build"),
  mode: "upstream",
  platform: "ios",
  expoRevision: "expo-revision",
  candidateRevision: null,
  configurationHash: ContentHash.make("0".repeat(64)),
  bundleHash: ContentHash.make("0".repeat(64)),
  nativeBinaryHash: null,
  nativeFingerprint: null,
  toolchainFingerprint: null,
  buildDecision: "full-build",
  nativeArtifact: null,
  performance: { architecture: "test", phases: [], caches: [] },
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
  id: RunId.make("ios-source-run"),
  build,
  device: { platform: "ios", id: "simulator", applicationId: "dev.betternative.compatibility" },
  unit: {
    id: "ios-expo_network-source",
    runner: "native-app",
    platform: "ios",
    sourceId: TestSourceId.make("expo-app-suite#apps/test-suite/tests/Network.js"),
  },
  timeoutMillis: 120_000,
}
const batchRequest: NativeBatchRequest = {
  ...request,
  units: [
    request.unit,
    {
      ...request.unit,
      id: "ios-expo_crypto-source",
      sourceId: TestSourceId.make("expo-app-suite#apps/test-suite/tests/Crypto.js"),
    },
  ],
}

describe("NativeMaestroFlow", () => {
  it("lets Maestro clear state before cold-launching one short source selection", () => {
    const flow = make(request)
    assert.include(flow, "- clearState")
    assert.include(flow, "- openLink:")
    assert.include(flow, 'id: "compatibility_run_selection"')
    assert.include(flow, 'text: "expo-app-suite#apps/test-suite/tests/Network.js"')
    assert.include(flow, 'id: "compatibility_run_complete"')
    assert.include(flow, 'id: "compatibility_run_error"')
    assert.include(flow, "source=expo-app-suite%23apps%2Ftest-suite%2Ftests%2FNetwork.js")
    assert.notInclude(flow, "caseIds")
    assert.notInclude(flow, "case=")
  })

  it("uses one short cohort selector for the pinned Expo native E2E batch", () => {
    const flow = makeBatch(batchRequest)
    assert.include(flow, "- clearState")
    assert.include(
      flow,
      "sources=6578706f2d6170702d737569746523617070732f746573742d73756974652f74657374732f4e6574776f726b2e6a73%2C6578706f2d6170702d737569746523617070732f746573742d73756974652f74657374732f43727970746f2e6a73",
    )
    assert.include(flow, 'id: "compatibility_run_selection"')
    assert.include(flow, 'text: "native-e2e"')
    assert.notInclude(flow, "source=")
    assert.notInclude(flow, "cohort=")
    assert.notInclude(flow, "caseIds")
  })
})
