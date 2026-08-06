import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as Prompt from "effect/unstable/ai/Prompt"
import * as Domain from "../../Domain.ts"
import type * as CodingTools from "../tools/index.ts"

/** Validated semantic provider-context policy recorded with each reviewed agent profile. */
export const Policy = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  maximumTokens: Domain.PositiveInteger,
  reserveTokens: Domain.PositiveInteger,
  keepRecentTokens: Domain.PositiveInteger,
  maximumSummaryOutputTokens: Domain.PositiveInteger,
  maximumCandidateBytes: Domain.PositiveInteger,
}).check(
  Schema.makeFilter(
    (policy) =>
      policy.reserveTokens < policy.maximumTokens &&
      policy.keepRecentTokens <= policy.maximumTokens - policy.reserveTokens,
    {
      expected:
        "a compaction policy whose reserve is below the maximum and whose recent context fits the usable budget",
    },
  ),
)
export type Policy = Schema.Schema.Type<typeof Policy>

/** Conservative context budget: enough room to work without replaying every old tool result. */
export const defaultPolicy = Schema.decodeUnknownSync(Policy)({
  schemaVersion: 2,
  maximumTokens: 20_000,
  reserveTokens: 8_000,
  keepRecentTokens: 8_000,
  maximumSummaryOutputTokens: 512,
  maximumCandidateBytes: 16 * 1_024,
})

/** Result of compacting only the provider-facing prompt. */
export const Result = Schema.Union([
  Schema.Struct({ compacted: Schema.Literal(false), prompt: Prompt.Prompt }),
  Schema.Struct({
    compacted: Schema.Literal(true),
    prompt: Prompt.Prompt,
    checkpoint: Schema.String,
    estimatedTokensBefore: Schema.Int,
    estimatedTokensAfter: Schema.Int,
  }),
])
export type Result = Schema.Schema.Type<typeof Result>
export type CompactedResult = Extract<Result, { readonly compacted: true }>

/** Provider-facing work required to replace old context with a semantic checkpoint. */
export interface Preparation {
  readonly originalPrompt: Prompt.Prompt
  readonly fixedMessages: ReadonlyArray<Prompt.Message>
  readonly recentMessages: ReadonlyArray<Prompt.Message>
  readonly messagesToSummarize: ReadonlyArray<Prompt.Message>
  readonly summaryPrompt: Prompt.Prompt
  readonly deterministicCheckpoint: string
  readonly estimatedTokensBefore: number
  readonly targetTokensAfterCompaction: number
}

export type Prepared =
  | { readonly compacted: false; readonly prompt: Prompt.Prompt }
  | { readonly compacted: true; readonly preparation: Preparation }

const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength
const boundUtf8 = (value: string, maximumBytes: number): string => {
  const encoded = new TextEncoder().encode(value)
  return encoded.byteLength <= maximumBytes
    ? value
    : `${new TextDecoder().decode(encoded.slice(0, maximumBytes))}\n\n[Candidate snapshot truncated; use read to retrieve the current file.]`
}

/** Pi-style conservative token estimate. Exact provider tokenizers are deliberately not required. */
export const estimateTokens = (prompt: Prompt.Prompt): number =>
  Math.ceil(
    prompt.content.reduce((total, message) => total + utf8Length(JSON.stringify(message)), 0) / 4,
  )

const estimateMessageTokens = (message: Prompt.Message): number =>
  Math.ceil(utf8Length(JSON.stringify(message)) / 4)

const changedEditableFiles = (state: CodingTools.WorkspaceState) =>
  [...state.editablePaths]
    .flatMap((path) => {
      const content = state.files.get(path)
      return content === undefined || content === state.originals.get(path)
        ? []
        : [{ path: path as string, content }]
    })
    .sort((left, right) => left.path.localeCompare(right.path))

const toolActivity = (transcript: ReadonlyArray<Domain.TranscriptEvent>): string => {
  const counts = new Map<string, number>()
  const paths = new Set<string>()
  for (const event of transcript) {
    Match.value(event).pipe(
      Match.when({ type: "tool_call" }, (call) => {
        counts.set(call.name, (counts.get(call.name) ?? 0) + 1)
        const path = call.arguments.path
        if (typeof path === "string") paths.add(path)
      }),
      Match.orElse(() => undefined),
    )
  }
  const calls = [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name}=${count}`)
    .join(", ")
  const inspected = [...paths].sort().slice(-12).join(", ")
  return [
    `Tool calls so far: ${calls.length === 0 ? "none" : calls}.`,
    `Paths touched or inspected: ${inspected.length === 0 ? "none" : inspected}.`,
  ].join("\n")
}

const latestCompileResult = (
  transcript: ReadonlyArray<Domain.TranscriptEvent>,
): Extract<Domain.TranscriptEvent, { readonly type: "tool_result" }> | undefined => {
  for (let index = transcript.length - 1; index >= 0; index--) {
    const event = transcript.at(index)
    if (event === undefined) continue
    const result = Match.value(event).pipe(
      Match.when({ type: "tool_result", name: "check_submission" }, (compile) => compile),
      Match.orElse(() => undefined),
    )
    if (result !== undefined) return result
  }
  return undefined
}

const checkpointText = (
  state: CodingTools.WorkspaceState,
  transcript: ReadonlyArray<Domain.TranscriptEvent>,
  policy: Policy,
): string => {
  const changed = changedEditableFiles(state)
  const candidate =
    changed.length === 0
      ? "(No editable file differs from its starting state.)"
      : boundUtf8(
          changed
            .map(({ path, content }) => `### ${path}\n\`\`\`ts\n${content}\n\`\`\``)
            .join("\n\n"),
          policy.maximumCandidateBytes,
        )
  const compile = latestCompileResult(transcript)
  const compileSummary = compile === undefined ? "not run" : JSON.stringify(compile.content)
  return [
    "Context checkpoint: older agent/tool messages were compacted by the harness. The canonical evidence transcript remains complete.",
    toolActivity(transcript),
    `Latest check_submission result: ${compileSummary}`,
    "Current changed editable-file snapshot:",
    candidate,
    "Continue from the preserved critical context and current workspace state. Implement now, run check_submission, fix actionable diagnostics, and submit. Do not repeat completed exploration.",
  ].join("\n\n")
}

const recentStart = (messages: ReadonlyArray<Prompt.Message>, keepRecentTokens: number): number => {
  let tokens = 0
  let start = messages.length
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages.at(index)
    if (message === undefined) continue
    tokens += estimateMessageTokens(message)
    const startsCompleteTurn = Match.value(message.role).pipe(
      Match.when("assistant", () => true),
      Match.when("system", () => false),
      Match.when("user", () => false),
      Match.when("tool", () => false),
      Match.exhaustive,
    )
    if (startsCompleteTurn) start = index
    // If the budget is crossed inside an older tool result, cut at the already discovered newer
    // assistant boundary. If the newest result alone is oversized, continue to its own assistant
    // call so the provider never receives an orphaned result.
    if (tokens >= keepRecentTokens && start < messages.length) break
  }
  return start
}

const targetTokensAfterCompaction = (policy: Policy): number => {
  const trigger = policy.maximumTokens - policy.reserveTokens
  return trigger <= 2_000 ? trigger : Math.floor(trigger * 0.8)
}

const dropOldestCompleteTurn = (
  messages: ReadonlyArray<Prompt.Message>,
): ReadonlyArray<Prompt.Message> => {
  for (let index = 1; index < messages.length; index++) {
    if (messages[index]?.role === "assistant") return messages.slice(index)
  }
  return []
}

const fitRecentMessages = (
  fixedMessages: ReadonlyArray<Prompt.Message>,
  checkpoint: string,
  recentMessages: ReadonlyArray<Prompt.Message>,
  targetTokens: number,
): Prompt.Prompt => {
  let retained = recentMessages
  while (true) {
    const candidate = Prompt.fromMessages([
      ...fixedMessages,
      Prompt.userMessage({
        content: [Prompt.makePart("text", { text: checkpoint })],
      }),
      ...retained,
    ])
    if (estimateTokens(candidate) <= targetTokens || retained.length === 0) return candidate
    retained = dropOldestCompleteTurn(retained)
  }
}

const semanticSummarySystemInstruction =
  "You create context checkpoints for a bounded coding agent. Summarize the supplied older " +
  "conversation; do not continue the task and do not call tools. Preserve exact public API names, " +
  "type signatures, error tags, diagnostics, file paths, decisions, failed approaches, and the " +
  "next concrete implementation step. Never invent facts that are absent from the conversation."

const semanticSummaryRequest = (messages: ReadonlyArray<Prompt.Message>): string =>
  [
    "<conversation>",
    JSON.stringify(messages),
    "</conversation>",
    "Create a concise checkpoint using exactly these headings:",
    "## Goal",
    "## Constraints",
    "## API and declaration discoveries",
    "## Progress and failed approaches",
    "## Current implementation state",
    "## Next actions",
    "## Critical exact context",
  ].join("\n")

/** Selects a safe assistant/tool boundary and prepares one tool-free semantic summarization call. */
export const prepare = (
  prompt: Prompt.Prompt,
  state: CodingTools.WorkspaceState,
  transcript: ReadonlyArray<Domain.TranscriptEvent>,
  policy: Policy,
): Prepared => {
  const estimatedTokensBefore = estimateTokens(prompt)
  if (estimatedTokensBefore <= policy.maximumTokens - policy.reserveTokens) {
    return { compacted: false, prompt }
  }

  const fixedMessages = prompt.content.slice(0, 2)
  const history = prompt.content.slice(2)
  const start = recentStart(history, policy.keepRecentTokens)
  const messagesToSummarize = history.slice(0, start)
  if (messagesToSummarize.length === 0) return { compacted: false, prompt }

  return {
    compacted: true,
    preparation: {
      originalPrompt: prompt,
      fixedMessages,
      recentMessages: history.slice(start),
      messagesToSummarize,
      summaryPrompt: Prompt.fromMessages([
        Prompt.systemMessage({ content: semanticSummarySystemInstruction }),
        Prompt.userMessage({
          content: [
            Prompt.makePart("text", {
              text: semanticSummaryRequest(messagesToSummarize),
            }),
          ],
        }),
      ]),
      deterministicCheckpoint: checkpointText(state, transcript, policy),
      estimatedTokensBefore,
      targetTokensAfterCompaction: targetTokensAfterCompaction(policy),
    },
  }
}

/** Combines the semantic history handoff with deterministic, verifier-independent workspace state. */
export const complete = (preparation: Preparation, semanticSummary: string): CompactedResult => {
  const checkpoint = [
    "Context checkpoint: older agent/tool messages were compacted by the harness. The canonical evidence transcript remains complete.",
    "Semantic history summary:",
    semanticSummary.trim().length === 0
      ? "(The summarizer returned no semantic text; rely on the deterministic state below.)"
      : semanticSummary.trim(),
    "Deterministic workspace state:",
    preparation.deterministicCheckpoint,
  ].join("\n\n")
  const compactedPrompt = fitRecentMessages(
    preparation.fixedMessages,
    checkpoint,
    preparation.recentMessages,
    preparation.targetTokensAfterCompaction,
  )
  return {
    compacted: true,
    prompt: compactedPrompt,
    checkpoint,
    estimatedTokensBefore: preparation.estimatedTokensBefore,
    estimatedTokensAfter: estimateTokens(compactedPrompt),
  }
}

/**
 * Synchronous fallback for callers without a LanguageModel summarizer. The live agent loop uses
 * {@link prepare} and {@link complete} to add a semantic history summary. The full evidence
 * transcript is never modified.
 */
export const compact = (
  prompt: Prompt.Prompt,
  state: CodingTools.WorkspaceState,
  transcript: ReadonlyArray<Domain.TranscriptEvent>,
  policy: Policy,
): Result => {
  const prepared = prepare(prompt, state, transcript, policy)
  return Match.value(prepared).pipe(
    Match.when({ compacted: false }, ({ prompt: unchanged }) => ({
      compacted: false as const,
      prompt: unchanged,
    })),
    Match.when({ compacted: true }, ({ preparation }) =>
      complete(
        preparation,
        "No semantic summarizer was supplied. Preserve the recent verbatim context and deterministic workspace state.",
      ),
    ),
    Match.exhaustive,
  )
}
