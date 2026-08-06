import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Prompt from "effect/unstable/ai/Prompt"
import type * as AiError from "effect/unstable/ai/AiError"
import * as LanguageModel from "effect/unstable/ai/LanguageModel"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Toolkit from "effect/unstable/ai/Toolkit"
import * as OpenRouterLanguageModel from "@effect/ai-openrouter/OpenRouterLanguageModel"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as AgentProfiles from "./AgentProfiles.ts"
import * as CompileCheck from "./CompileCheck.ts"
import * as Domain from "../Domain.ts"
import * as Submission from "../security/Submission.ts"
import * as TaskWorkspace from "../tasks/TaskWorkspace.ts"
import * as CodingTools from "./tools/index.ts"
import * as Compaction from "./compaction/Compaction.ts"
import * as CompletionGuidance from "./CompletionGuidance.ts"
import * as SystemPrompt from "./SystemPrompt.ts"

export { CodingToolkit } from "./tools/index.ts"

/** Why the bounded coding loop returned control to the harness. */
export type AgentExitReason =
  | "submitted"
  | "model-finished"
  | "turn-limit"
  | "token-limit"
  | "cost-limit"
  | "cost-unavailable"
  | "duration-limit"

/** Complete real-agent result before deterministic verification. */
export interface AgentRunResult {
  readonly submission: Submission.Submission
  readonly transcript: ReadonlyArray<Domain.TranscriptEvent>
  readonly usage: Domain.UsageSummary
  readonly profile: AgentProfiles.AgentProfile
  readonly exitReason: AgentExitReason
}

interface UsageState {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly cachedInputTokens: number
  readonly totalTokens: number
  readonly costUsd: number
  readonly costAvailable: boolean
  readonly toolCalls: number
  readonly turns: number
  readonly compactions: number
  readonly compactionInputTokens: number
  readonly compactionOutputTokens: number
  readonly compactionReasoningTokens: number
  readonly compactionTotalTokens: number
  readonly compactionCostUsd: number
  readonly compactionEstimatedTokensBefore: number
  readonly compactionEstimatedTokensAfter: number
  readonly provider?: string
  readonly providerFingerprint?: string
}

const emptyUsage: UsageState = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  costAvailable: true,
  toolCalls: 0,
  turns: 0,
  compactions: 0,
  compactionInputTokens: 0,
  compactionOutputTokens: 0,
  compactionReasoningTokens: 0,
  compactionTotalTokens: 0,
  compactionCostUsd: 0,
  compactionEstimatedTokensBefore: 0,
  compactionEstimatedTokensAfter: 0,
}

const toToolCallId = (id: string, turn: number, index: number) =>
  Domain.ToolCallId.make(id.length > 0 ? id : `agent-${turn}-${index}`)

type ObservedUsage = Pick<
  UsageState,
  | "inputTokens"
  | "outputTokens"
  | "reasoningTokens"
  | "cachedInputTokens"
  | "totalTokens"
  | "toolCalls"
  | "provider"
  | "providerFingerprint"
> & { readonly costUsd?: number }

const usageFromResponse = (response: LanguageModel.GenerateTextResponse<any>): ObservedUsage => {
  const finish = response.content.find((part) => part.type === "finish")
  const openrouter = finish?.metadata.openrouter
  const rawUsage = openrouter?.usage
  const inputTokens = response.usage.inputTokens.total ?? 0
  const outputTokens = response.usage.outputTokens.total ?? 0
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: response.usage.outputTokens.reasoning ?? 0,
    cachedInputTokens: response.usage.inputTokens.cacheRead ?? 0,
    totalTokens: rawUsage?.total_tokens ?? inputTokens + outputTokens,
    ...(rawUsage?.cost === undefined || rawUsage.cost === null ? {} : { costUsd: rawUsage.cost }),
    toolCalls: response.toolCalls.length,
    ...(openrouter?.provider === undefined || openrouter.provider === null
      ? {}
      : { provider: openrouter.provider }),
    ...(openrouter?.systemFingerprint === undefined || openrouter.systemFingerprint === null
      ? {}
      : { providerFingerprint: openrouter.systemFingerprint }),
  }
}

const addUsage = (
  left: UsageState,
  right: ObservedUsage,
  source: "agent" | "compaction" = "agent",
): UsageState => ({
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
  totalTokens: left.totalTokens + right.totalTokens,
  costUsd: left.costUsd + (right.costUsd ?? 0),
  costAvailable: left.costAvailable && right.costUsd !== undefined,
  toolCalls: left.toolCalls + (source === "agent" ? right.toolCalls : 0),
  turns: left.turns + (source === "agent" ? 1 : 0),
  compactions: left.compactions + (source === "compaction" ? 1 : 0),
  compactionInputTokens:
    left.compactionInputTokens + (source === "compaction" ? right.inputTokens : 0),
  compactionOutputTokens:
    left.compactionOutputTokens + (source === "compaction" ? right.outputTokens : 0),
  compactionReasoningTokens:
    left.compactionReasoningTokens + (source === "compaction" ? right.reasoningTokens : 0),
  compactionTotalTokens:
    left.compactionTotalTokens + (source === "compaction" ? right.totalTokens : 0),
  compactionCostUsd: left.compactionCostUsd + (source === "compaction" ? (right.costUsd ?? 0) : 0),
  compactionEstimatedTokensBefore: left.compactionEstimatedTokensBefore,
  compactionEstimatedTokensAfter: left.compactionEstimatedTokensAfter,
  ...(right.provider === undefined ? {} : { provider: right.provider }),
  ...(right.providerFingerprint === undefined
    ? {}
    : { providerFingerprint: right.providerFingerprint }),
})

const responseTranscript = (
  response: LanguageModel.GenerateTextResponse<Toolkit.Tools<typeof CodingTools.CodingToolkit>>,
  turn: number,
): ReadonlyArray<Domain.TranscriptEvent> => {
  const events: Array<Domain.TranscriptEvent> = []
  if (response.text.length > 0) {
    events.push({ type: "message", role: "assistant", content: response.text })
  }
  response.toolCalls.forEach((toolCall, index) => {
    events.push({
      type: "tool_call",
      id: toToolCallId(toolCall.id, turn, index),
      name: toolCall.name,
      arguments: Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
        toolCall.params,
      ),
    })
  })
  response.toolResults.forEach((toolResult, index) => {
    events.push({
      type: "tool_result",
      toolCallId: toToolCallId(toolResult.id, turn, index),
      name: toolResult.name,
      content: Schema.decodeUnknownSync(Schema.Json)(toolResult.encodedResult),
    })
  })
  return events
}

const systemInstruction = SystemPrompt.defaultSystemPrompt

const runScoped = Effect.fn("DxEvals.AgentLoop.run")(function* (
  profile: AgentProfiles.AgentProfile,
  seed: TaskWorkspace.AgentWorkspaceSeed,
  instruction: string,
  checkSubmission: CodingTools.CheckSubmissionHandler,
) {
  const workspace = yield* Ref.make(CodingTools.makeState(seed))
  const usage = yield* Ref.make<UsageState>(emptyUsage)
  const transcript = yield* Ref.make<ReadonlyArray<Domain.TranscriptEvent>>([
    { type: "message", role: "system", content: systemInstruction },
    { type: "message", role: "user", content: instruction },
  ])
  const systemMessage = Prompt.systemMessage({
    content: systemInstruction,
    ...Match.value(profile.promptCaching).pipe(
      Match.when("system", () => ({
        options: {
          openrouter: { cacheControl: { type: "ephemeral" as const } },
        },
      })),
      Match.when("disabled", () => ({})),
      Match.exhaustive,
    ),
  })
  const initialPrompt = Prompt.fromMessages([
    systemMessage,
    Prompt.userMessage({
      content: [Prompt.makePart("text", { text: instruction })],
    }),
  ])
  const handlers = CodingTools.makeHandlers(workspace, checkSubmission, profile.workspaceLimits)
  const handlerContext = yield* Layer.build(handlers)

  const loop = (
    turn: number,
    prompt: Prompt.Prompt,
  ): Effect.Effect<AgentExitReason, AiError.AiError, LanguageModel.LanguageModel> =>
    Effect.gen(function* () {
      const beforeRequest = yield* Ref.get(usage)
      const beforeRequestExit = Match.value({
        turnLimit: turn >= profile.maxTurns,
        tokenLimit:
          beforeRequest.outputTokens >= profile.maxTotalOutputTokens ||
          beforeRequest.totalTokens >= profile.maxObservedTotalTokens,
      }).pipe(
        Match.when({ turnLimit: true }, () => "turn-limit" as const),
        Match.when({ tokenLimit: true }, () => "token-limit" as const),
        Match.orElse(() => null),
      )
      if (beforeRequestExit !== null) return beforeRequestExit
      const prepared = Compaction.prepare(
        prompt,
        yield* Ref.get(workspace),
        yield* Ref.get(transcript),
        profile.compaction,
      )
      const compacted = yield* Match.value(prepared).pipe(
        Match.when({ compacted: false }, ({ prompt: unchanged }) =>
          Effect.succeed({ compacted: false as const, prompt: unchanged }),
        ),
        Match.when({ compacted: true }, ({ preparation }) =>
          LanguageModel.generateText({
            prompt: preparation.summaryPrompt,
          }).pipe(
            OpenRouterLanguageModel.withConfigOverride({
              ...AgentProfiles.tokenLimitConfig(
                profile,
                profile.compaction.maximumSummaryOutputTokens,
              ),
              reasoning: { effort: profile.compactionReasoningEffort },
            }),
            Effect.map((response) => ({
              response,
              result: Compaction.complete(preparation, response.text),
            })),
            Effect.tap(({ response, result }) =>
              Ref.update(usage, (current) => {
                const accumulated = addUsage(current, usageFromResponse(response), "compaction")
                return {
                  ...accumulated,
                  compactionEstimatedTokensBefore:
                    accumulated.compactionEstimatedTokensBefore + result.estimatedTokensBefore,
                  compactionEstimatedTokensAfter:
                    accumulated.compactionEstimatedTokensAfter + result.estimatedTokensAfter,
                }
              }),
            ),
            Effect.map(({ result }) => result),
          ),
        ),
        Match.exhaustive,
      )
      const providerPrompt = yield* Match.value(compacted).pipe(
        Match.when({ compacted: false }, ({ prompt: providerContext }) =>
          Effect.succeed(providerContext),
        ),
        Match.when({ compacted: true }, ({ checkpoint, prompt: providerContext }) =>
          Ref.update(transcript, (events) => [
            ...events,
            {
              type: "message" as const,
              role: "user" as const,
              content: checkpoint,
            },
          ]).pipe(Effect.as(providerContext)),
        ),
        Match.exhaustive,
      )
      const guidance = CompletionGuidance.forRequest(
        turn,
        profile.maxTurns,
        yield* Ref.get(workspace),
        yield* Ref.get(transcript),
        profile.maxObservedTotalTokens - (yield* Ref.get(usage)).totalTokens,
        Compaction.estimateTokens(providerPrompt) + profile.maxOutputTokensPerTurn,
      )
      const requestPrompt =
        guidance === undefined
          ? providerPrompt
          : Prompt.concat(
              providerPrompt,
              Prompt.fromMessages([
                Prompt.userMessage({
                  content: [Prompt.makePart("text", { text: guidance })],
                }),
              ]),
            )
      if (guidance !== undefined) {
        yield* Ref.update(transcript, (events) => [
          ...events,
          {
            type: "message" as const,
            role: "user" as const,
            content: guidance,
          },
        ])
      }
      const beforeAgentRequest = yield* Ref.get(usage)
      if (
        beforeAgentRequest.outputTokens >= profile.maxTotalOutputTokens ||
        beforeAgentRequest.totalTokens >= profile.maxObservedTotalTokens
      ) {
        return "token-limit"
      }
      const remainingOutputTokens = profile.maxTotalOutputTokens - beforeAgentRequest.outputTokens
      const response = yield* LanguageModel.generateText({
        prompt: requestPrompt,
        toolkit: CodingTools.CodingToolkit,
        concurrency: 1,
      }).pipe(
        OpenRouterLanguageModel.withConfigOverride({
          ...AgentProfiles.tokenLimitConfig(
            profile,
            Math.min(profile.maxOutputTokensPerTurn, remainingOutputTokens),
          ),
        }),
        Effect.provide(handlerContext),
      )
      const observed = usageFromResponse(response)
      const accumulated = yield* Ref.updateAndGet(usage, (current) => addUsage(current, observed))
      yield* Ref.update(transcript, (events) => [...events, ...responseTranscript(response, turn)])
      const state = yield* Ref.get(workspace)
      const afterResponseExit = Match.value({
        tokenLimit:
          accumulated.outputTokens >= profile.maxTotalOutputTokens ||
          accumulated.totalTokens >= profile.maxObservedTotalTokens,
        costUnavailable: !accumulated.costAvailable,
        costLimit: accumulated.costUsd >= profile.observedCostStopUsd,
        submitted: state.submitted,
        modelFinished: response.toolCalls.length === 0,
      }).pipe(
        Match.when({ tokenLimit: true }, () => "token-limit" as const),
        Match.when({ costUnavailable: true }, () => "cost-unavailable" as const),
        Match.when({ costLimit: true }, () => "cost-limit" as const),
        Match.when({ submitted: true }, () => "submitted" as const),
        Match.when({ modelFinished: true }, () => "model-finished" as const),
        Match.orElse(() => null),
      )
      if (afterResponseExit !== null) return afterResponseExit
      return yield* Effect.suspend(() =>
        loop(turn + 1, Prompt.concat(requestPrompt, Prompt.fromResponseParts(response.content))),
      )
    })

  const exitReason = yield* loop(0, initialPrompt).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(profile.timeoutMilliseconds),
      orElse: () => Effect.succeed("duration-limit" as const),
    }),
  )
  const finalState = yield* Ref.get(workspace)
  const finalUsage = yield* Ref.get(usage)
  return {
    submission: CodingTools.makeSubmission(finalState),
    transcript: yield* Ref.get(transcript),
    usage: {
      provider: finalUsage.provider ?? profile.providerPolicy.only[0],
      model: profile.model,
      inputTokens: finalUsage.inputTokens,
      outputTokens: finalUsage.outputTokens,
      reasoningTokens: finalUsage.reasoningTokens,
      cachedInputTokens: finalUsage.cachedInputTokens,
      totalTokens: finalUsage.totalTokens,
      toolCalls: finalUsage.toolCalls,
      retries: 0,
      turns: finalUsage.turns,
      compactions: finalUsage.compactions,
      compactionInputTokens: finalUsage.compactionInputTokens,
      compactionOutputTokens: finalUsage.compactionOutputTokens,
      compactionReasoningTokens: finalUsage.compactionReasoningTokens,
      compactionTotalTokens: finalUsage.compactionTotalTokens,
      compactionEstimatedTokensBefore: finalUsage.compactionEstimatedTokensBefore,
      compactionEstimatedTokensAfter: finalUsage.compactionEstimatedTokensAfter,
      ...(finalUsage.costAvailable ? { compactionCostUsd: finalUsage.compactionCostUsd } : {}),
      ...(finalUsage.costAvailable ? { costUsd: finalUsage.costUsd } : {}),
      ...(finalUsage.providerFingerprint === undefined
        ? {}
        : { providerFingerprint: finalUsage.providerFingerprint }),
    },
    profile,
    exitReason,
  } satisfies AgentRunResult
})

/** Runs one bounded coding-agent trial using the LanguageModel in the Effect context. */
export const run = (
  profile: AgentProfiles.AgentProfile,
  seed: TaskWorkspace.AgentWorkspaceSeed,
  instruction: string,
  checkSubmission: CodingTools.CheckSubmissionHandler = () =>
    Effect.succeed(CompileCheck.unavailable),
) => Effect.scoped(runScoped(profile, seed, instruction, checkSubmission))
