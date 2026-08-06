import { defineConfig } from "vitest/config"
import { makeDefaultCampaignId } from "./tooling/dx-evals/src/campaign/RunIdentity.ts"

const requestedRunId = process.env.BETTER_NATIVE_EVAL_RUN_ID
const liveEnabled = process.env.BETTER_NATIVE_EVAL_LIVE === "1"
const runId = requestedRunId ?? makeDefaultCampaignId(Date.now(), crypto.randomUUID())
process.env.BETTER_NATIVE_EVAL_RUN_ID = runId

if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
  throw new Error("BETTER_NATIVE_EVAL_RUN_ID must be a safe path segment of at most 128 characters")
}

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["tooling/dx-evals/evals/**/*.eval.ts"],
    testTimeout: liveEnabled ? 330_000 : 30_000,
    hookTimeout: liveEnabled ? 330_000 : 30_000,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    reporters: ["vitest-evals/reporter", "json"],
    outputFile: {
      json: `.artifacts/evals/${runId}/outputFile.json`,
    },
  },
})
