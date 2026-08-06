import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as LanguageModel from "effect/unstable/ai/LanguageModel"
import * as OpenRouterLanguageModel from "@effect/ai-openrouter/OpenRouterLanguageModel"
import { toCodecOpenAI } from "effect/unstable/ai/OpenAiStructuredOutput"
import * as Option from "effect/Option"
import type * as Response from "effect/unstable/ai/Response"
import * as AgentLoop from "./AgentLoop.ts"
import type * as AgentProfiles from "./AgentProfiles.ts"
import * as Compaction from "./compaction/Compaction.ts"
import * as VirtualWorkspace from "./tools/VirtualWorkspace.ts"
import * as Domain from "../Domain.ts"
import * as Submission from "../security/Submission.ts"
import type * as TaskWorkspace from "../tasks/TaskWorkspace.ts"
import { provideLayer } from "../TestLayers.ts"

const profile = {
  schemaVersion: 3,
  id: Domain.AgentProfileId.make("fake-model"),
  model: "fake/model",
  reasoningEffort: "none",
  compactionReasoningEffort: "none",
  tokenParameter: "max_tokens",
  maxTurns: 4,
  maxOutputTokensPerTurn: 128,
  maxTotalOutputTokens: 512,
  maxObservedTotalTokens: 100_000,
  timeoutMilliseconds: 5_000,
  observedCostStopUsd: 1,
  promptCaching: "disabled",
  compaction: Compaction.defaultPolicy,
  workspaceLimits: VirtualWorkspace.defaultLimits,
  providerPolicy: {
    only: ["fake"],
    allowFallbacks: false,
    requireParameters: true,
    dataCollection: "deny",
    zeroDataRetention: true,
  },
} as const satisfies AgentProfiles.AgentProfile

const seed: TaskWorkspace.AgentWorkspaceSeed = {
  files: [
    {
      path: Domain.TaskRelativePath.make("src/example.ts"),
      content: "export const value = 0\n",
    },
  ],
  editablePaths: new Set([Domain.TaskRelativePath.make("src/example.ts")]),
  packageDigests: new Map(),
}

const declarationSeed: TaskWorkspace.AgentWorkspaceSeed = {
  files: [
    ...seed.files,
    {
      path: Domain.TaskRelativePath.make("public-packages/example/index.d.ts"),
      content: "export declare const value: number\n",
    },
    {
      path: Domain.TaskRelativePath.make("node_modules/effect/dist/Effect.d.ts"),
      content: "export declare const matchEffect: unknown\n",
    },
  ],
  editablePaths: seed.editablePaths,
  packageDigests: new Map(),
}

const finish = (cost?: number): Response.FinishPartEncoded => ({
  type: "finish",
  reason: "tool-calls",
  usage: {
    inputTokens: { total: 10 },
    outputTokens: { total: 5, reasoning: 1 },
  },
  metadata: {
    openrouter: {
      provider: "fake-provider",
      systemFingerprint: "fake-fingerprint",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        ...(cost === undefined ? {} : { cost }),
      },
    },
  },
})

const fakeLanguageModel = (
  generateText: (
    turn: number,
    options: LanguageModel.ProviderOptions,
    tokenLimits: {
      readonly max_tokens?: number | null
      readonly max_completion_tokens?: number | null
      readonly reasoningEffort?: AgentProfiles.ReasoningEffort | "max" | "xhigh" | null
    },
  ) => ReadonlyArray<Response.PartEncoded>,
) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const turns = yield* Ref.make(0)
      return yield* LanguageModel.make({
        generateText: (options) =>
          Effect.gen(function* () {
            const override = yield* Effect.serviceOption(OpenRouterLanguageModel.Config)
            const turn = yield* Ref.getAndUpdate(turns, (current) => current + 1)
            const config = Option.getOrUndefined(override)
            return [
              ...generateText(turn, options, {
                ...(config?.max_tokens === undefined ? {} : { max_tokens: config.max_tokens }),
                ...(config?.max_completion_tokens === undefined
                  ? {}
                  : { max_completion_tokens: config.max_completion_tokens }),
                ...(config?.reasoning?.effort === undefined
                  ? {}
                  : { reasoningEffort: config.reasoning.effort }),
              }),
            ]
          }),
        streamText: () => Stream.empty,
      })
    }),
  )

describe("Effect AI coding loop", () => {
  it("exposes tool parameter schemas accepted by OpenAI-compatible frontier models", () => {
    assert.strictEqual(
      AgentLoop.CodingToolkit.tools.read.parametersSchema,
      VirtualWorkspace.ReadRequest,
    )
    assert.strictEqual(
      AgentLoop.CodingToolkit.tools.grep.successSchema,
      VirtualWorkspace.SearchResult,
    )
    assert.doesNotThrow(() => toCodecOpenAI(AgentLoop.CodingToolkit.tools.ls.parametersSchema))
    assert.doesNotThrow(() => toCodecOpenAI(AgentLoop.CodingToolkit.tools.find.parametersSchema))
    assert.doesNotThrow(() => toCodecOpenAI(AgentLoop.CodingToolkit.tools.read.parametersSchema))
    assert.doesNotThrow(() => toCodecOpenAI(AgentLoop.CodingToolkit.tools.grep.parametersSchema))
    assert.doesNotThrow(() => toCodecOpenAI(AgentLoop.CodingToolkit.tools.edit.parametersSchema))
    assert.doesNotThrow(() => toCodecOpenAI(AgentLoop.CodingToolkit.tools.write.parametersSchema))
    assert.doesNotThrow(() =>
      toCodecOpenAI(AgentLoop.CodingToolkit.tools.check_submission.parametersSchema),
    )
    assert.doesNotThrow(() => toCodecOpenAI(AgentLoop.CodingToolkit.tools.submit.parametersSchema))
  })

  it.effect("allows public Effect declaration reads but keeps dependencies read-only", () =>
    Effect.gen(function* () {
      const responses: ReadonlyArray<ReadonlyArray<Response.PartEncoded>> = [
        [
          {
            type: "tool-call",
            id: "search-effect-public",
            name: "grep",
            params: {
              pattern: "matchEffect",
              path: "node_modules/effect/dist/Effect.d.ts",
            },
          },
          {
            type: "tool-call",
            id: "read-effect-public",
            name: "read",
            params: { path: "node_modules/effect/dist/Effect.d.ts" },
          },
          {
            type: "tool-call",
            id: "write-effect-denied",
            name: "write",
            params: {
              path: "node_modules/effect/dist/Effect.d.ts",
              content: "tampered\n",
            },
          },
          finish(0.01),
        ],
        [
          {
            type: "tool-call",
            id: "submit-effect-boundary",
            name: "submit",
            params: { confirm: true },
          },
          finish(0.01),
        ],
      ]
      const result = yield* AgentLoop.run(
        profile,
        declarationSeed,
        "Inspect Effect without modifying dependencies.",
      ).pipe(provideLayer(fakeLanguageModel((turn) => responses[turn] ?? [finish(0.01)])))
      const toolResults = result.transcript.filter((event) => event.type === "tool_result")
      const publicSearch = toolResults.find((event) => event.toolCallId === "search-effect-public")
      const publicRead = toolResults.find((event) => event.toolCallId === "read-effect-public")
      const deniedWrite = toolResults.find((event) => event.toolCallId === "write-effect-denied")

      assert.strictEqual(result.exitReason, "submitted")
      assert.deepStrictEqual(publicSearch?.content, {
        ok: true,
        matches: [
          {
            path: "node_modules/effect/dist/Effect.d.ts",
            line: 1,
            content: "1: export declare const matchEffect: unknown",
          },
        ],
        truncated: false,
        searchedFiles: 1,
      })
      assert.deepStrictEqual(publicRead?.content, {
        ok: true,
        content: "export declare const matchEffect: unknown",
        startLine: 1,
        endLine: 1,
        totalLines: 1,
        truncated: false,
      })
      assert.deepStrictEqual(deniedWrite?.content, {
        ok: false,
        error: "path-not-editable",
      })
      assert.deepStrictEqual(result.submission.entries, [])
    }),
  )

  it.effect("compacts provider context while preserving the complete evidence transcript", () =>
    Effect.gen(function* () {
      const largeDeclaration = `export declare const marker: "${"x".repeat(49_000)}"\n`
      const largeSeed: TaskWorkspace.AgentWorkspaceSeed = {
        ...seed,
        files: [
          ...seed.files,
          {
            path: Domain.TaskRelativePath.make("node_modules/effect/dist/Large.d.ts"),
            content: largeDeclaration,
          },
        ],
      }
      const prompts: Array<string> = []
      const summaryPrompts: Array<string> = []
      const summaryReasoningEfforts: Array<
        AgentProfiles.ReasoningEffort | "max" | "xhigh" | null | undefined
      > = []
      let agentTurn = 0
      const result = yield* AgentLoop.run(
        {
          ...profile,
          compactionReasoningEffort: "medium",
          compaction: {
            ...Compaction.defaultPolicy,
            maximumTokens: 2_000,
            reserveTokens: 500,
            keepRecentTokens: 1_000,
          },
        },
        largeSeed,
        "Inspect the large declaration.",
      ).pipe(
        provideLayer(
          fakeLanguageModel((_request, options, providerConfig) => {
            const encodedPrompt = JSON.stringify(options.prompt)
            if (encodedPrompt.includes("You create context checkpoints")) {
              summaryPrompts.push(encodedPrompt)
              summaryReasoningEfforts.push(providerConfig.reasoningEffort)
              return [
                {
                  type: "text",
                  text: "## API and declaration discoveries\nThe large declaration exposed marker.",
                },
                finish(0.002),
              ]
            }
            prompts.push(encodedPrompt)
            const currentTurn = agentTurn
            agentTurn += 1
            return Match.value(currentTurn).pipe(
              Match.when(
                0,
                (): ReadonlyArray<Response.PartEncoded> => [
                  {
                    type: "tool-call",
                    id: "read-large",
                    name: "read",
                    params: { path: "node_modules/effect/dist/Large.d.ts" },
                  },
                  finish(0.01),
                ],
              ),
              Match.when(
                1,
                (): ReadonlyArray<Response.PartEncoded> => [
                  {
                    type: "tool-call",
                    id: "list-after-large-read",
                    name: "ls",
                    params: { path: "src" },
                  },
                  finish(0.01),
                ],
              ),
              Match.orElse(
                (): ReadonlyArray<Response.PartEncoded> => [
                  {
                    type: "tool-call",
                    id: "submit-after-compaction",
                    name: "submit",
                    params: { confirm: true },
                  },
                  finish(0.01),
                ],
              ),
            )
          }),
        ),
      )

      assert.strictEqual(result.exitReason, "submitted")
      assert.include(prompts[0] ?? "", "Inspect the large declaration")
      assert.include(prompts[1] ?? "", "x".repeat(1_000))
      assert.notInclude(prompts[2] ?? "", "x".repeat(1_000))
      assert.include(prompts[2] ?? "", "Context checkpoint")
      assert.include(prompts[2] ?? "", "The large declaration exposed marker")
      assert.lengthOf(summaryPrompts, 1)
      assert.deepStrictEqual(summaryReasoningEfforts, ["medium"])
      assert.strictEqual(result.usage.compactions, 1)
      assert.strictEqual(result.usage.compactionTotalTokens, 15)
      assert.strictEqual(result.usage.compactionCostUsd, 0.002)
      assert.isAbove(
        result.usage.compactionEstimatedTokensBefore ?? 0,
        result.usage.compactionEstimatedTokensAfter ?? 0,
      )
      assert.strictEqual(result.usage.turns, 3)
      const fullRead = result.transcript.find(
        (event) => event.type === "tool_result" && event.toolCallId === "read-large",
      )
      assert.include(JSON.stringify(fullRead), "x".repeat(1_000))
      assert.isTrue(
        result.transcript.some(
          (event) =>
            event.type === "message" &&
            event.role === "user" &&
            typeof event.content === "string" &&
            event.content.includes("canonical evidence transcript remains complete"),
        ),
      )
    }),
  )

  it.effect("uses the dynamic tool prompt and state-aware compilation guidance", () =>
    Effect.gen(function* () {
      const prompts: Array<string> = []
      const checked = yield* Ref.make(0)
      const responses: ReadonlyArray<ReadonlyArray<Response.PartEncoded>> = [
        [
          {
            type: "tool-call",
            id: "list-guided",
            name: "ls",
            params: {},
          },
          {
            type: "tool-call",
            id: "read-declaration-guided",
            name: "read",
            params: { path: "public-packages/example/index.d.ts" },
          },
          finish(0.01),
        ],
        [
          {
            type: "tool-call",
            id: "edit-guided",
            name: "edit",
            params: {
              path: "src/example.ts",
              oldText: "value = 0",
              newText: "value = 3",
            },
          },
          finish(0.01),
        ],
        [
          {
            type: "tool-call",
            id: "check-guided",
            name: "check_submission",
            params: { confirm: true },
          },
          finish(0.01),
        ],
        [
          {
            type: "tool-call",
            id: "submit-guided",
            name: "submit",
            params: { confirm: true },
          },
          finish(0.01),
        ],
      ]

      const result = yield* AgentLoop.run(
        profile,
        declarationSeed,
        "Update the exported value.",
        () =>
          Ref.update(checked, (count) => count + 1).pipe(
            Effect.as({
              status: "passed",
              diagnostics: [],
              truncated: false,
            } as const),
          ),
      ).pipe(
        provideLayer(
          fakeLanguageModel((turn, options) => {
            prompts.push(JSON.stringify(options.prompt))
            return responses[turn] ?? [finish(0.01)]
          }),
        ),
      )

      assert.strictEqual(result.exitReason, "submitted")
      assert.strictEqual(yield* Ref.get(checked), 1)
      assert.deepStrictEqual(
        result.transcript.flatMap((event) => (event.type === "tool_call" ? [event.name] : [])),
        ["ls", "read", "edit", "check_submission", "submit"],
      )
      assert.include(prompts[0] ?? "", "Available tools:")
      assert.include(prompts[0] ?? "", "check_submission: Compile the current editable files")
      assert.notInclude(prompts[0] ?? "", "relevant public declaration graph")
      assert.include(prompts[1] ?? "", "Three requests remain")
      assert.include(prompts[2] ?? "", "candidate changed since its last compilation")
      assert.include(prompts[3] ?? "", "passed check_submission")
      assert.isTrue(
        result.transcript.some(
          (event) =>
            event.type === "message" &&
            event.role === "user" &&
            typeof event.content === "string" &&
            event.content.includes("candidate changed since its last compilation"),
        ),
      )
    }),
  )

  it.effect("marks compilation stale after every later edit and guides repeated checks", () =>
    Effect.gen(function* () {
      const prompts: Array<string> = []
      const checked = yield* Ref.make(0)
      const responses: ReadonlyArray<ReadonlyArray<Response.PartEncoded>> = [
        [
          {
            type: "tool-call",
            id: "write-first-candidate",
            name: "write",
            params: {
              path: "src/example.ts",
              content: "export const value = missing\n",
            },
          },
          finish(0.01),
        ],
        [
          {
            type: "tool-call",
            id: "check-first-candidate",
            name: "check_submission",
            params: { confirm: true },
          },
          finish(0.01),
        ],
        [
          {
            type: "tool-call",
            id: "fix-first-diagnostic",
            name: "edit",
            params: {
              path: "src/example.ts",
              edits: [{ oldText: "missing", newText: "1" }],
            },
          },
          finish(0.01),
        ],
        [
          {
            type: "tool-call",
            id: "check-fixed-candidate",
            name: "check_submission",
            params: { confirm: true },
          },
          finish(0.01),
        ],
        [
          {
            type: "tool-call",
            id: "edit-after-passing-check",
            name: "edit",
            params: {
              path: "src/example.ts",
              edits: [{ oldText: "1", newText: "2" }],
            },
          },
          finish(0.01),
        ],
        [
          {
            type: "tool-call",
            id: "recheck-after-late-edit",
            name: "check_submission",
            params: { confirm: true },
          },
          finish(0.01),
        ],
        [
          {
            type: "tool-call",
            id: "submit-rechecked-candidate",
            name: "submit",
            params: { confirm: true },
          },
          finish(0.01),
        ],
      ]

      const result = yield* AgentLoop.run(
        {
          ...profile,
          maxTurns: 7,
          maxTotalOutputTokens: 896,
          maxObservedTotalTokens: 100_000,
        },
        seed,
        "Update the exported value.",
        () =>
          Ref.getAndUpdate(checked, (count) => count + 1).pipe(
            Effect.map((count) =>
              count === 0
                ? ({
                    status: "failed",
                    diagnostics: [
                      {
                        code: 2304,
                        category: "error",
                        message: "Cannot find name 'missing'.",
                      },
                    ],
                    truncated: false,
                  } as const)
                : ({
                    status: "passed",
                    diagnostics: [],
                    truncated: false,
                  } as const),
            ),
          ),
      ).pipe(
        provideLayer(
          fakeLanguageModel((turn, options) => {
            prompts.push(JSON.stringify(options.prompt))
            return responses[turn] ?? [finish(0.01)]
          }),
        ),
      )

      assert.strictEqual(result.exitReason, "submitted")
      assert.strictEqual(yield* Ref.get(checked), 3)
      assert.include(prompts[1] ?? "", "candidate changed since its last compilation")
      assert.include(prompts[2] ?? "", "failed check_submission")
      assert.include(prompts[3] ?? "", "candidate changed since its last compilation")
      assert.include(prompts[4] ?? "", "passed check_submission")
      assert.include(prompts[5] ?? "", "candidate changed since its last compilation")
      assert.include(prompts[6] ?? "", "passed check_submission")
    }),
  )

  it.effect("checks the current changed-file submission before submit", () =>
    Effect.gen(function* () {
      const checked = yield* Ref.make<ReadonlyArray<Submission.Submission>>([])
      const responses: ReadonlyArray<ReadonlyArray<Response.PartEncoded>> = [
        [
          {
            type: "tool-call",
            id: "write-before-check",
            name: "write",
            params: {
              path: "src/example.ts",
              content: "export const value = 2\n",
            },
          },
          finish(0.01),
        ],
        [
          {
            type: "tool-call",
            id: "compile-current-submission",
            name: "check_submission",
            params: { confirm: true },
          },
          finish(0.01),
        ],
        [
          {
            type: "tool-call",
            id: "submit-after-check",
            name: "submit",
            params: { confirm: true },
          },
          finish(0.01),
        ],
      ]
      const result = yield* AgentLoop.run(
        profile,
        seed,
        "Update and compile the exported value.",
        (submission) =>
          Ref.update(checked, (submissions) => [...submissions, submission]).pipe(
            Effect.as({
              status: "passed",
              diagnostics: [],
              truncated: false,
            } as const),
          ),
      ).pipe(provideLayer(fakeLanguageModel((turn) => responses[turn] ?? [finish(0.01)])))

      assert.strictEqual(result.exitReason, "submitted")
      assert.deepStrictEqual(yield* Ref.get(checked), [
        {
          entries: [
            {
              kind: "file",
              path: "src/example.ts",
              content: "export const value = 2\n",
            },
          ],
        },
      ])
      assert.isTrue(
        result.transcript.some(
          (event) => event.type === "tool_result" && event.name === "check_submission",
        ),
      )
    }),
  )

  it.effect("executes real Effect AI tools across turns and submits changed files", () =>
    Effect.gen(function* () {
      const result = yield* AgentLoop.run(profile, seed, "Update the exported value.").pipe(
        provideLayer(
          fakeLanguageModel((turn) =>
            turn === 0
              ? [
                  {
                    type: "tool-call",
                    id: "write-1",
                    name: "write",
                    params: {
                      path: "src/example.ts",
                      content: "export const value = 1\n",
                    },
                  },
                  finish(0.01),
                ]
              : [
                  {
                    type: "tool-call",
                    id: "submit-1",
                    name: "submit",
                    params: { confirm: true },
                  },
                  finish(0.01),
                ],
          ),
        ),
      )

      assert.strictEqual(result.exitReason, "submitted")
      assert.deepStrictEqual(result.submission.entries, [
        {
          kind: "file",
          path: "src/example.ts",
          content: "export const value = 1\n",
        },
      ])
      assert.strictEqual(result.usage.turns, 2)
      assert.strictEqual(result.usage.toolCalls, 2)
      assert.strictEqual(result.usage.totalTokens, 30)
      assert.strictEqual(result.usage.costUsd, 0.02)
      assert.strictEqual(result.usage.provider, "fake-provider")
      assert.isTrue(result.transcript.some((event) => event.type === "tool_result"))
    }),
  )

  it.effect("returns a non-integer read window as bounded tool feedback", () =>
    Effect.gen(function* () {
      const result = yield* AgentLoop.run(profile, seed, "Inspect the workspace.").pipe(
        provideLayer(
          fakeLanguageModel((turn) =>
            turn === 0
              ? [
                  {
                    type: "tool-call",
                    id: "fractional-read",
                    name: "read",
                    params: { path: "src/example.ts", offset: 1.5 },
                  },
                  finish(0.01),
                ]
              : [finish(0.01)],
          ),
        ),
      )

      assert.strictEqual(result.exitReason, "model-finished")
      assert.strictEqual(result.usage.turns, 2)
      assert.isTrue(
        result.transcript.some(
          (event) =>
            event.type === "tool_result" &&
            event.name === "read" &&
            typeof event.content === "object" &&
            event.content !== null &&
            "error" in event.content &&
            event.content.error === "invalid-offset",
        ),
      )
    }),
  )

  it.effect("accepts explicit null read options as provider defaults", () =>
    Effect.gen(function* () {
      const result = yield* AgentLoop.run(profile, seed, "Inspect the workspace.").pipe(
        provideLayer(
          fakeLanguageModel((turn) =>
            turn === 0
              ? [
                  {
                    type: "tool-call",
                    id: "null-read-options",
                    name: "read",
                    params: {
                      path: "src/example.ts",
                      offset: null,
                      limit: null,
                    },
                  },
                  finish(0.01),
                ]
              : [finish(0.01)],
          ),
        ),
      )

      assert.strictEqual(result.exitReason, "model-finished")
      assert.strictEqual(result.usage.turns, 2)
      assert.isTrue(
        result.transcript.some(
          (event) =>
            event.type === "tool_result" &&
            event.name === "read" &&
            typeof event.content === "object" &&
            event.content !== null &&
            "ok" in event.content &&
            event.content.ok === true,
        ),
      )
    }),
  )

  it.effect("stops a cooperative agent at the declared turn limit", () =>
    Effect.gen(function* () {
      const result = yield* AgentLoop.run(
        { ...profile, maxTurns: 2 },
        seed,
        "Keep inspecting.",
      ).pipe(
        provideLayer(
          fakeLanguageModel((turn) => [
            {
              type: "tool-call",
              id: `list-${turn}`,
              name: "ls",
              params: {},
            },
            finish(0),
          ]),
        ),
      )

      assert.strictEqual(result.exitReason, "turn-limit")
      assert.strictEqual(result.usage.turns, 2)
      assert.deepStrictEqual(result.submission.entries, [])
    }),
  )

  it.effect("stops before another turn after a response crosses the observed cost stop", () =>
    Effect.gen(function* () {
      const result = yield* AgentLoop.run(
        { ...profile, observedCostStopUsd: 0.1 },
        seed,
        "Inspect the files.",
      ).pipe(
        provideLayer(
          fakeLanguageModel(() => [
            {
              type: "tool-call",
              id: "list-cost",
              name: "ls",
              params: {},
            },
            finish(0.2),
          ]),
        ),
      )

      assert.strictEqual(result.exitReason, "cost-limit")
      assert.strictEqual(result.usage.turns, 1)
      assert.strictEqual(result.usage.costUsd, 0.2)
    }),
  )

  it.effect("fails closed when a provider omits cost accounting", () =>
    Effect.gen(function* () {
      const result = yield* AgentLoop.run(profile, seed, "Inspect the files.").pipe(
        provideLayer(
          fakeLanguageModel(() => [
            {
              type: "tool-call",
              id: "list-no-cost",
              name: "ls",
              params: {},
            },
            finish(),
          ]),
        ),
      )

      assert.strictEqual(result.exitReason, "cost-unavailable")
      assert.isUndefined(result.usage.costUsd)
    }),
  )

  it.effect("does not let submit bypass a reached cost limit", () =>
    Effect.gen(function* () {
      const result = yield* AgentLoop.run(
        { ...profile, observedCostStopUsd: 0.1 },
        seed,
        "Submit immediately.",
      ).pipe(
        provideLayer(
          fakeLanguageModel(() => [
            {
              type: "tool-call",
              id: "submit-cost",
              name: "submit",
              params: { confirm: true },
            },
            finish(0.1),
          ]),
        ),
      )
      assert.strictEqual(result.exitReason, "cost-limit")
    }),
  )

  it.effect("does not let submit bypass missing provider cost evidence", () =>
    Effect.gen(function* () {
      const result = yield* AgentLoop.run(profile, seed, "Submit immediately.").pipe(
        provideLayer(
          fakeLanguageModel(() => [
            {
              type: "tool-call",
              id: "submit-no-cost",
              name: "submit",
              params: { confirm: true },
            },
            finish(),
          ]),
        ),
      )
      assert.strictEqual(result.exitReason, "cost-unavailable")
    }),
  )

  it.effect("clamps each provider request to the remaining output-token allowance", () =>
    Effect.gen(function* () {
      const observedLimits: Array<number | undefined> = []
      const result = yield* AgentLoop.run(
        { ...profile, maxOutputTokensPerTurn: 5, maxTotalOutputTokens: 6 },
        seed,
        "Keep inspecting.",
      ).pipe(
        provideLayer(
          fakeLanguageModel((turn, _options, tokenLimits) => {
            observedLimits.push(tokenLimits.max_tokens ?? undefined)
            return [
              {
                type: "tool-call",
                id: `list-${turn}`,
                name: "ls",
                params: {},
              },
              finish(0),
            ]
          }),
        ),
      )
      assert.deepStrictEqual(observedLimits, [5, 1])
      assert.strictEqual(result.exitReason, "token-limit")
    }),
  )

  it.effect("uses max_completion_tokens only for a reviewed completion-token profile", () =>
    Effect.gen(function* () {
      const observedLimits: Array<{
        readonly max_tokens?: number | null
        readonly max_completion_tokens?: number | null
      }> = []
      const result = yield* AgentLoop.run(
        {
          ...profile,
          tokenParameter: "max_completion_tokens",
          maxOutputTokensPerTurn: 5,
          maxTotalOutputTokens: 6,
        },
        seed,
        "Keep inspecting.",
      ).pipe(
        provideLayer(
          fakeLanguageModel((turn, _options, tokenLimits) => {
            observedLimits.push(tokenLimits)
            return [
              {
                type: "tool-call",
                id: `list-completion-${turn}`,
                name: "ls",
                params: {},
              },
              finish(0),
            ]
          }),
        ),
      )
      assert.deepStrictEqual(observedLimits, [
        { max_completion_tokens: 5 },
        { max_completion_tokens: 1 },
      ])
      assert.strictEqual(result.exitReason, "token-limit")
    }),
  )
})
