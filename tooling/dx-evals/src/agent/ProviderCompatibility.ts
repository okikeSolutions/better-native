import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as AiError from "effect/unstable/ai/AiError"
import type * as Generated from "@effect/ai-openrouter/Generated"
import * as OpenRouterClient from "@effect/ai-openrouter/OpenRouterClient"
import * as AgentLoop from "./AgentLoop.ts"
import * as AgentProfiles from "./AgentProfiles.ts"
import * as CompileCheck from "./CompileCheck.ts"
import * as OpenRouterAgent from "./OpenRouterAgent.ts"
import * as Domain from "../Domain.ts"
import * as TaskWorkspace from "../tasks/TaskWorkspace.ts"

const maximumOutputTokens = 512
const maximumProtocolTurns = 12
const maximumProbeCostUsd = 0.15
const timeoutMilliseconds = 120_000

const CompatibilityParameters = Schema.fromJsonString(Schema.Struct({ ok: Schema.Literal(true) }))

export type Compatible = {
  readonly status: "compatible"
  readonly model: string
  readonly configuredProvider: string
  readonly routingEvidence: "single-provider-no-fallback"
  readonly tokenParameter: AgentProfiles.AgentProfile["tokenParameter"]
  readonly maximumOutputTokens: number
  readonly maximumProtocolTurns: number
  readonly timeoutMilliseconds: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd: number
}

export type Quarantined = {
  readonly status: "quarantined"
  readonly model: string
  readonly configuredProvider: string
  readonly tokenParameter: AgentProfiles.AgentProfile["tokenParameter"]
  readonly maximumOutputTokens: number
  readonly maximumProtocolTurns: number
  readonly timeoutMilliseconds: number
  readonly reason:
    | "malformed-response"
    | "missing-tool-call"
    | "missing-usage-evidence"
    | "provider-error"
    | "timeout"
  readonly providerErrorType?: AiError.AiError["reason"]["_tag"]
  readonly providerToolName?: string
  readonly providerToolParameterShape?: Readonly<Record<string, string>>
  readonly providerErrorDescription?: string
}

export type Result = Compatible | Quarantined

const jsonType = (value: unknown): string =>
  Match.value({ isNull: value === null, isArray: Array.isArray(value) }).pipe(
    Match.when({ isNull: true }, () => "null"),
    Match.when({ isArray: true }, () => "array"),
    Match.orElse(() => typeof value),
  )

const parameterShape = (value: unknown): Readonly<Record<string, string>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, jsonType(entry)]),
      )
    : undefined

const parameterShapeField = (value: unknown) => {
  const shape = parameterShape(value)
  return shape === undefined ? {} : { providerToolParameterShape: shape }
}

const baseResult = (profile: AgentProfiles.AgentProfile) => ({
  model: profile.model,
  configuredProvider: profile.providerPolicy.only[0]!,
  tokenParameter: profile.tokenParameter,
  maximumOutputTokens,
  maximumProtocolTurns,
  timeoutMilliseconds,
})

const quarantined = (
  profile: AgentProfiles.AgentProfile,
  reason: Quarantined["reason"],
): Quarantined => ({ status: "quarantined", ...baseResult(profile), reason })

/** Assesses one already schema-decoded OpenRouter response without invoking task verification. */
export const assessResponse = (
  profile: AgentProfiles.AgentProfile,
  response: Generated.SendChatCompletionRequest200,
): Result => {
  const toolCall = response.choices[0]?.message.tool_calls?.find(
    (call) => call.function.name === "compatibility_ready",
  )
  const parameters =
    toolCall === undefined
      ? Option.none()
      : Schema.decodeUnknownOption(CompatibilityParameters)(toolCall.function.arguments)
  if (Option.isNone(parameters)) return quarantined(profile, "missing-tool-call")
  const cost = response.usage?.cost
  if (response.usage === undefined || cost === undefined || cost === null) {
    return quarantined(profile, "missing-usage-evidence")
  }
  return {
    status: "compatible",
    ...baseResult(profile),
    routingEvidence: "single-provider-no-fallback",
    inputTokens: response.usage.prompt_tokens,
    outputTokens: response.usage.completion_tokens,
    costUsd: cost,
  }
}

/** Maps provider decoding failures into quarantine findings rather than task failures. */
export const classifyFailure = (
  profile: AgentProfiles.AgentProfile,
  error: AiError.AiError,
): Quarantined => ({
  ...quarantined(
    profile,
    Match.value(error.reason).pipe(
      Match.when({ _tag: "InvalidOutputError" }, () => "malformed-response" as const),
      Match.orElse(() => "provider-error" as const),
    ),
  ),
  providerErrorType: error.reason._tag,
  ...(error.reason._tag === "ToolParameterValidationError"
    ? {
        providerToolName: error.reason.toolName,
        ...parameterShapeField(error.reason.toolParams),
      }
    : {}),
  ...(error.reason._tag === "InvalidRequestError" && error.reason.description !== undefined
    ? { providerErrorDescription: error.reason.description.slice(0, 256) }
    : {}),
})

/** Runs the compatibility probe against the profile's one explicit OpenRouter provider. */
export const probe = (
  profile: AgentProfiles.AgentProfile,
): Effect.Effect<Result, never, OpenRouterClient.OpenRouterClient> =>
  Effect.gen(function* () {
    const provider = profile.providerPolicy
    const client = yield* OpenRouterClient.OpenRouterClient
    const [response] = yield* client.createChatCompletion({
      model: profile.model,
      messages: [
        {
          role: "user",
          content: "Call compatibility_ready exactly once with ok=true. Do not answer with text.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "compatibility_ready",
            description: "Confirm that this provider can return a schema-valid tool call.",
            parameters: {
              type: "object",
              properties: { ok: { type: "boolean", const: true } },
              required: ["ok"],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "compatibility_ready" },
      },
      ...AgentProfiles.tokenLimitConfig(profile, maximumOutputTokens),
      reasoning: { effort: profile.reasoningEffort },
      provider: {
        only: provider.only,
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: provider.dataCollection,
        zdr: provider.zeroDataRetention,
      },
    })
    return assessResponse(profile, response)
  }).pipe(
    Effect.catchTag("AiError", (error) => Effect.succeed(classifyFailure(profile, error))),
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMilliseconds),
      orElse: () => Effect.succeed(quarantined(profile, "timeout")),
    }),
  )

/**
 * Probes one request through the exact coding prompt, toolkit codec, and virtual-workspace handlers.
 * A one-request profile keeps this compatibility instrument distinct from a scored task trial.
 */
export const probeCodingProtocol = (profile: AgentProfiles.AgentProfile) =>
  Effect.scoped(
    Effect.gen(function* () {
      const task = yield* TaskWorkspace.loadTask(Domain.TaskId.make("network"))
      const seed = yield* TaskWorkspace.makeAgentWorkspaceSeed(task)
      const checkSubmission = yield* CompileCheck.makeChecker(task)
      const boundedProfile: AgentProfiles.AgentProfile = {
        ...profile,
        maxTurns: maximumProtocolTurns,
        maxOutputTokensPerTurn: maximumOutputTokens,
        maxTotalOutputTokens: maximumOutputTokens * maximumProtocolTurns,
        maxObservedTotalTokens: 100_000,
        observedCostStopUsd: Math.min(profile.observedCostStopUsd, maximumProbeCostUsd),
        timeoutMilliseconds,
      }
      const modelContext = yield* Layer.build(OpenRouterAgent.modelLayer(boundedProfile))
      const run = yield* AgentLoop.run(
        boundedProfile,
        seed,
        task.instruction,
        checkSubmission,
      ).pipe(Effect.provide(modelContext))
      const cost = run.usage.costUsd
      if (cost === undefined) return quarantined(profile, "missing-usage-evidence")
      return {
        status: "compatible" as const,
        ...baseResult(profile),
        routingEvidence: "single-provider-no-fallback" as const,
        inputTokens: run.usage.inputTokens ?? 0,
        outputTokens: run.usage.outputTokens ?? 0,
        costUsd: cost,
      }
    }).pipe(
      Effect.catchTag("AiError", (error) => Effect.succeed(classifyFailure(profile, error))),
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMilliseconds),
        orElse: () => Effect.succeed(quarantined(profile, "timeout")),
      }),
    ),
  )
