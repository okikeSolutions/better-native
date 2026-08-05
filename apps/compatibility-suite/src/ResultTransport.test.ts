import { assert, beforeEach, describe, it, vi } from "vitest"

const { writeAsStringAsync } = vi.hoisted(() => ({
  writeAsStringAsync: vi.fn(() => Promise.resolve()),
}))

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  writeAsStringAsync,
}))

import * as android from "./ResultTransport.android.ts"
import * as ios from "./ResultTransport.ios.ts"
import * as web from "./ResultTransport.ts"
import type { RunSummary } from "./Runner.ts"

const summary = {
  schemaVersion: 1,
  runId: "platform/run",
  buildId: "test-build",
  mode: "upstream",
  results: [],
  runtimeDiscoveredCaseIds: [],
} satisfies RunSummary

describe("result transport platform contract", () => {
  beforeEach(() => {
    writeAsStringAsync.mockClear()
  })

  it("keeps the rendered JSON fallback on Android", async () => {
    assert.isTrue(android.rendersResultPayload)
    await android.publishResult(summary.runId, summary)
    assert.lengthOf(writeAsStringAsync.mock.calls, 0)
  })

  it("keeps rendered JSON as the web result channel", async () => {
    assert.isTrue(web.rendersResultPayload)
    await web.publishResult(summary.runId, summary)
    assert.lengthOf(writeAsStringAsync.mock.calls, 0)
  })

  it("persists iOS results without rendering the payload", async () => {
    assert.isFalse(ios.rendersResultPayload)
    await ios.publishResult(summary.runId, summary)
    assert.deepEqual(writeAsStringAsync.mock.calls, [
      ["file:///documents/better-native-result-cGxhdGZvcm0vcnVu.json", JSON.stringify(summary)],
    ])
  })
})
