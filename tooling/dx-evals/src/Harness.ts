import { createHarness, toJsonValue, type JsonValue, type TranscriptEvent } from "vitest-evals"
import * as Match from "effect/Match"
import type { TranscriptEvent as DomainTranscriptEvent, TrialInputEncoded } from "./Domain.ts"
import type { UsageSummary as DomainUsageSummary } from "./Domain.ts"
import { dxEvalRuntime } from "./Runtime.ts"
import { runTrial } from "./TrialRunner.ts"

const invocationCounts = new Map<string, number>()

/** Returns how often the real custom-harness callback was entered for one run identity. */
export const getHarnessInvocationCount = (runId: string): number => invocationCounts.get(runId) ?? 0

const requireJsonValue = (value: unknown): JsonValue => {
  const normalized = toJsonValue(value)
  if (normalized === undefined) {
    throw new Error("Vitest Evals could not normalize a required JSON value")
  }
  return normalized
}

const normalizeRecord = (value: Readonly<Record<string, unknown>>): Record<string, JsonValue> =>
  Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, requireJsonValue(entry)]))

const normalizeTranscriptEvent = (event: DomainTranscriptEvent): TranscriptEvent =>
  Match.value(event).pipe(
    Match.when({ type: "message" }, (message) => ({
      type: message.type,
      role: message.role,
      content: requireJsonValue(message.content),
    })),
    Match.when({ type: "tool_call" }, (toolCall) => ({
      type: toolCall.type,
      id: toolCall.id,
      name: toolCall.name,
      arguments: normalizeRecord(toolCall.arguments),
    })),
    Match.when({ type: "tool_result" }, (toolResult) => ({
      type: toolResult.type,
      toolCallId: toolResult.toolCallId,
      name: toolResult.name,
      content: requireJsonValue(toolResult.content),
    })),
    Match.exhaustive,
  )

const normalizeUsage = (usage: DomainUsageSummary) => ({
  ...(usage.provider === undefined ? {} : { provider: usage.provider }),
  ...(usage.model === undefined ? {} : { model: usage.model }),
  ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
  ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
  ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
  ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
  ...(usage.toolCalls === undefined ? {} : { toolCalls: usage.toolCalls }),
  ...(usage.retries === undefined ? {} : { retries: usage.retries }),
  metadata: {
    ...(usage.cachedInputTokens === undefined
      ? {}
      : { cachedInputTokens: usage.cachedInputTokens }),
    ...(usage.turns === undefined ? {} : { turns: usage.turns }),
    ...(usage.compactions === undefined ? {} : { compactions: usage.compactions }),
    ...(usage.compactionInputTokens === undefined
      ? {}
      : { compactionInputTokens: usage.compactionInputTokens }),
    ...(usage.compactionOutputTokens === undefined
      ? {}
      : { compactionOutputTokens: usage.compactionOutputTokens }),
    ...(usage.compactionReasoningTokens === undefined
      ? {}
      : { compactionReasoningTokens: usage.compactionReasoningTokens }),
    ...(usage.compactionTotalTokens === undefined
      ? {}
      : { compactionTotalTokens: usage.compactionTotalTokens }),
    ...(usage.compactionCostUsd === undefined
      ? {}
      : { compactionCostUsd: usage.compactionCostUsd }),
    ...(usage.compactionEstimatedTokensBefore === undefined
      ? {}
      : {
          compactionEstimatedTokensBefore: usage.compactionEstimatedTokensBefore,
        }),
    ...(usage.compactionEstimatedTokensAfter === undefined
      ? {}
      : {
          compactionEstimatedTokensAfter: usage.compactionEstimatedTokensAfter,
        }),
    ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
    ...(usage.providerFingerprint === undefined
      ? {}
      : { providerFingerprint: usage.providerFingerprint }),
  },
})

/**
 * Vitest Evals adapter for the Effect-native DX eval application.
 *
 * The adapter runs one trial on the process-owned managed runtime and exposes only normalized,
 * JSON-safe output, transcript events, usage, and a public evidence reference.
 */
export const dxHarness = createHarness<TrialInputEncoded, JsonValue>({
  name: "better-native-dx",
  run: async ({ input, setArtifact, signal }) => {
    invocationCounts.set(input.runId, getHarnessInvocationCount(input.runId) + 1)
    const outcome = await dxEvalRuntime.runPromise(
      runTrial(input),
      signal === undefined ? undefined : { signal },
    )

    setArtifact("evidence-reference", outcome.publicEvidence)

    return {
      output: requireJsonValue(outcome),
      events: outcome.transcript.map(normalizeTranscriptEvent),
      usage: normalizeUsage(outcome.usage),
    }
  },
})
