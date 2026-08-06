import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import * as Prompt from "effect/unstable/ai/Prompt"
import * as Domain from "../../Domain.ts"
import type * as CodingTools from "../tools/index.ts"
import * as Compaction from "./Compaction.ts"

const state: CodingTools.WorkspaceState = {
  files: new Map([["src/example.ts", "export const value = 2\n"]]),
  originals: new Map([["src/example.ts", "export const value = 0\n"]]),
  editablePaths: new Set([Domain.TaskRelativePath.make("src/example.ts")]),
  submitted: false,
}

const initial = Prompt.fromMessages([
  Prompt.systemMessage({ content: "system" }),
  Prompt.userMessage({ content: [Prompt.makePart("text", { text: "task" })] }),
])

const policy = (overrides: Partial<Compaction.Policy>) =>
  Schema.decodeUnknownSync(Compaction.Policy)({
    ...Compaction.defaultPolicy,
    ...overrides,
  })

describe("agent context compaction", () => {
  it("leaves prompts below the trigger unchanged", () => {
    const result = Compaction.compact(
      initial,
      state,
      [],
      policy({
        maximumTokens: 100,
        reserveTokens: 10,
        keepRecentTokens: 20,
      }),
    )
    assert.isFalse(result.compacted)
    assert.strictEqual(result.prompt, initial)
  })

  it("keeps a complete recent assistant/tool turn and replaces bulky old results", () => {
    const old = Prompt.fromMessages([
      Prompt.assistantMessage({
        content: [
          Prompt.makePart("tool-call", {
            id: "old-read",
            name: "read",
            params: { path: "node_modules/effect/Schema.d.ts" },
            providerExecuted: false,
          }),
        ],
      }),
      Prompt.toolMessage({
        content: [
          Prompt.makePart("tool-result", {
            id: "old-read",
            name: "read",
            isFailure: false,
            result: { ok: true, content: "x".repeat(20_000) },
          }),
        ],
      }),
      Prompt.assistantMessage({
        content: [
          Prompt.makePart("tool-call", {
            id: "recent-write",
            name: "write",
            params: {
              path: "src/example.ts",
              content: "export const value = 2\n",
            },
            providerExecuted: false,
          }),
        ],
      }),
      Prompt.toolMessage({
        content: [
          Prompt.makePart("tool-result", {
            id: "recent-write",
            name: "write",
            isFailure: false,
            result: { ok: true, content: "updated" },
          }),
        ],
      }),
    ])
    const transcript: ReadonlyArray<Domain.TranscriptEvent> = [
      {
        type: "tool_call",
        id: Domain.ToolCallId.make("old-read"),
        name: "read",
        arguments: { path: "node_modules/effect/Schema.d.ts" },
      },
      {
        type: "tool_result",
        toolCallId: Domain.ToolCallId.make("compile"),
        name: "check_submission",
        content: {
          status: "failed",
          diagnostics: ["TS1234"],
          truncated: false,
        },
      },
    ]
    const result = Compaction.compact(
      Prompt.concat(initial, old),
      state,
      transcript,
      policy({
        maximumTokens: 4_000,
        reserveTokens: 1_000,
        keepRecentTokens: 1_000,
      }),
    )
    assert.isTrue(result.compacted)
    if (!result.compacted) return
    const encoded = JSON.stringify(result.prompt)
    assert.notInclude(encoded, "x".repeat(1_000))
    assert.include(encoded, "recent-write")
    assert.include(result.checkpoint, "export const value = 2")
    assert.include(result.checkpoint, "TS1234")
    assert.include(result.checkpoint, "canonical evidence transcript remains complete")
    const recentAssistant = result.prompt.content.at(-2)
    const recentTool = result.prompt.content.at(-1)
    assert.strictEqual(recentAssistant?.role, "assistant")
    assert.strictEqual(recentTool?.role, "tool")
  })

  it("cuts before an older oversized tool pair without orphaning the recent pair", () => {
    const history = Prompt.fromMessages([
      Prompt.assistantMessage({
        content: [
          Prompt.makePart("tool-call", {
            id: "old",
            name: "read",
            params: { path: "old.d.ts" },
            providerExecuted: false,
          }),
        ],
      }),
      Prompt.toolMessage({
        content: [
          Prompt.makePart("tool-result", {
            id: "old",
            name: "read",
            isFailure: false,
            result: { content: "o".repeat(4_000) },
          }),
        ],
      }),
      Prompt.assistantMessage({
        content: [
          Prompt.makePart("tool-call", {
            id: "recent",
            name: "grep",
            params: { pattern: "catchTags" },
            providerExecuted: false,
          }),
        ],
      }),
      Prompt.toolMessage({
        content: [
          Prompt.makePart("tool-result", {
            id: "recent",
            name: "grep",
            isFailure: false,
            result: { matches: ["catchTags"] },
          }),
        ],
      }),
    ])
    const prepared = Compaction.prepare(
      Prompt.concat(initial, history),
      state,
      [],
      policy({ maximumTokens: 500, reserveTokens: 100, keepRecentTokens: 100 }),
    )
    assert.isTrue(prepared.compacted)
    if (!prepared.compacted) return
    assert.include(JSON.stringify(prepared.preparation.messagesToSummarize), "old.d.ts")
    assert.notInclude(JSON.stringify(prepared.preparation.recentMessages), "old.d.ts")
    assert.include(JSON.stringify(prepared.preparation.recentMessages), "catchTags")
    assert.strictEqual(prepared.preparation.recentMessages[0]?.role, "assistant")
    assert.strictEqual(prepared.preparation.recentMessages[1]?.role, "tool")
  })

  it("fits the checkpoint below its headroom target and avoids immediate recompaction", () => {
    const history = Prompt.fromMessages([
      Prompt.assistantMessage({
        content: [
          Prompt.makePart("tool-call", {
            id: "oversized-read",
            name: "read",
            params: { path: "node_modules/effect/Schema.d.ts" },
            providerExecuted: false,
          }),
        ],
      }),
      Prompt.toolMessage({
        content: [
          Prompt.makePart("tool-result", {
            id: "oversized-read",
            name: "read",
            isFailure: false,
            result: { content: "b".repeat(24_000) },
          }),
        ],
      }),
      Prompt.assistantMessage({
        content: [
          Prompt.makePart("tool-call", {
            id: "recent-write",
            name: "write",
            params: {
              path: "src/example.ts",
              content: "export const value = 2\n",
            },
            providerExecuted: false,
          }),
        ],
      }),
      Prompt.toolMessage({
        content: [
          Prompt.makePart("tool-result", {
            id: "recent-write",
            name: "write",
            isFailure: false,
            result: { ok: true },
          }),
        ],
      }),
    ])
    const configured = policy({
      maximumTokens: 6_000,
      reserveTokens: 1_000,
      keepRecentTokens: 1_000,
    })
    const prepared = Compaction.prepare(Prompt.concat(initial, history), state, [], configured)
    assert.isTrue(prepared.compacted)
    if (!prepared.compacted) return

    const compacted = Compaction.complete(
      prepared.preparation,
      "The agent inspected Schema and updated src/example.ts.",
    )
    assert.isAtMost(
      compacted.estimatedTokensAfter,
      prepared.preparation.targetTokensAfterCompaction,
    )
    assert.isAtMost(compacted.estimatedTokensAfter, 4_000)

    const oneSmallTurn = Prompt.concat(
      compacted.prompt,
      Prompt.fromMessages([
        Prompt.assistantMessage({
          content: [Prompt.makePart("text", { text: "Compile next." })],
        }),
      ]),
    )
    const next = Compaction.prepare(oneSmallTurn, state, [], configured)
    assert.isFalse(next.compacted)
  })

  it("bounds large changed-file snapshots and directs the agent back to read", () => {
    const largeState: CodingTools.WorkspaceState = {
      ...state,
      files: new Map([["src/example.ts", "y".repeat(64 * 1_024)]]),
    }
    const oversized = Prompt.concat(
      initial,
      Prompt.fromMessages([
        Prompt.userMessage({
          content: [Prompt.makePart("text", { text: "z".repeat(4_000) })],
        }),
      ]),
    )
    const result = Compaction.compact(
      oversized,
      largeState,
      [],
      policy({
        maximumTokens: 500,
        reserveTokens: 100,
        keepRecentTokens: 100,
      }),
    )
    assert.isTrue(result.compacted)
    if (!result.compacted) return
    assert.isBelow(new TextEncoder().encode(result.checkpoint).byteLength, 18 * 1_024)
    assert.include(result.checkpoint, "Candidate snapshot truncated")
    assert.include(result.checkpoint, "use read")
  })
})
