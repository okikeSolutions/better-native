import { defineConfig } from "vitest/config"
import { makeDefaultCampaignId } from "./tooling/dx-evals/src/campaign/RunIdentity.ts"

const requestedRunId = process.env.BETTER_NATIVE_EVAL_RUN_ID
const requestedTask = process.env.BETTER_NATIVE_EVAL_TASK
const liveEnabled = process.env.BETTER_NATIVE_EVAL_LIVE === "1"
const runId = requestedRunId ?? makeDefaultCampaignId(Date.now(), crypto.randomUUID())
process.env.BETTER_NATIVE_EVAL_RUN_ID = runId

if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
  throw new Error("BETTER_NATIVE_EVAL_RUN_ID must be a safe path segment of at most 128 characters")
}

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: [
      requestedTask === undefined
        ? "tooling/dx-evals/evals/**/*.eval.ts"
        : `tooling/dx-evals/evals/${requestedTask}.eval.ts`,
    ],
    testTimeout: liveEnabled ? 330_000 : 30_000,
    hookTimeout: liveEnabled ? 330_000 : 30_000,
    // Paid campaigns remain strictly serialized. Secretless controls may use
    // two workers without recreating the resource contention of the root suite.
    fileParallelism: !liveEnabled,
    maxWorkers: liveEnabled ? 1 : 2,
    sequence: {
      concurrent: false,
    },
    experimental: {
      fsModuleCache: true,
    },
    reporters: ["vitest-evals/reporter", "json"],
    outputFile: {
      json: `.artifacts/evals/${runId}/outputFile.json`,
    },
  },
})
