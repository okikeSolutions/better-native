import type { RunSummary } from "./Runner.ts"

export const rendersResultPayload = true

export const publishResult = (_runId: string, _result: RunSummary): Promise<void> =>
  Promise.resolve()
