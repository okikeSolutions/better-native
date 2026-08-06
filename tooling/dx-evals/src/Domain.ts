import * as Schema from "effect/Schema"

/** Non-empty text used by decoded public and internal domain records. */
export const NonEmptyString = Schema.NonEmptyString
/** Decoded non-empty text accepted by {@link NonEmptyString}. */
export type NonEmptyString = Schema.Schema.Type<typeof NonEmptyString>

/** Integer strictly greater than zero. */
export const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0))
/** Decoded positive integer accepted by {@link PositiveInteger}. */
export type PositiveInteger = Schema.Schema.Type<typeof PositiveInteger>

/** Integer greater than or equal to zero. */
export const NonNegativeInteger = Schema.Natural
/** Decoded non-negative integer accepted by {@link NonNegativeInteger}. */
export type NonNegativeInteger = Schema.Schema.Type<typeof NonNegativeInteger>

/** Finite number strictly greater than zero. */
export const PositiveFinite = Schema.Finite.check(Schema.isGreaterThan(0))
/** Decoded positive finite number accepted by {@link PositiveFinite}. */
export type PositiveFinite = Schema.Schema.Type<typeof PositiveFinite>

/** Run identifier safe for use as one bounded artifact path segment. */
export const RunId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
).pipe(Schema.brand("@better-native/dx-evals/RunId"))
/** Decoded run identifier accepted by {@link RunId}. */
export type RunId = Schema.Schema.Type<typeof RunId>

/** Stable identifier for one versioned eval task. */
export const TaskId = NonEmptyString.pipe(Schema.brand("@better-native/dx-evals/TaskId"))
/** Decoded task identifier accepted by {@link TaskId}. */
export type TaskId = Schema.Schema.Type<typeof TaskId>

/** Version identity for a task whose fixtures and graders move together. */
export const TaskVersion = NonEmptyString.pipe(Schema.brand("@better-native/dx-evals/TaskVersion"))
/** Decoded task version accepted by {@link TaskVersion}. */
export type TaskVersion = Schema.Schema.Type<typeof TaskVersion>

/** Stable identifier for a reviewed agent adapter. */
export const AdapterId = NonEmptyString.pipe(Schema.brand("@better-native/dx-evals/AdapterId"))
/** Decoded adapter identifier accepted by {@link AdapterId}. */
export type AdapterId = Schema.Schema.Type<typeof AdapterId>

/** Stable identifier for one reviewed model and coding-harness configuration. */
export const AgentProfileId = NonEmptyString.pipe(
  Schema.brand("@better-native/dx-evals/AgentProfileId"),
)
/** Decoded agent-profile identifier accepted by {@link AgentProfileId}. */
export type AgentProfileId = Schema.Schema.Type<typeof AgentProfileId>

/** Stable identifier for one reviewed paid or deterministic campaign definition. */
export const CampaignId = NonEmptyString.pipe(Schema.brand("@better-native/dx-evals/CampaignId"))
/** Decoded campaign identifier accepted by {@link CampaignId}. */
export type CampaignId = Schema.Schema.Type<typeof CampaignId>

/** Identifier for one deterministic or reviewed gate. */
export const GateId = NonEmptyString.pipe(Schema.brand("@better-native/dx-evals/GateId"))
/** Decoded gate identifier accepted by {@link GateId}. */
export type GateId = Schema.Schema.Type<typeof GateId>

/** Identifier linking one canonical transcript tool call to its result. */
export const ToolCallId = NonEmptyString.pipe(Schema.brand("@better-native/dx-evals/ToolCallId"))
/** Decoded tool-call identifier accepted by {@link ToolCallId}. */
export type ToolCallId = Schema.Schema.Type<typeof ToolCallId>

/** JavaScript export name selected by verifier-owned task metadata. */
export const ExportName = Schema.String.check(Schema.isPattern(/^[A-Za-z_$][A-Za-z0-9_$]*$/)).pipe(
  Schema.brand("@better-native/dx-evals/ExportName"),
)
/** Decoded export name accepted by {@link ExportName}. */
export type ExportName = Schema.Schema.Type<typeof ExportName>

/** Normalized task-relative path that cannot escape a reconstructed workspace. */
export const TaskRelativePath = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      value.length > 0 &&
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      value
        .split("/")
        .every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    { expected: "a normalized task-relative path" },
  ),
).pipe(Schema.brand("@better-native/dx-evals/TaskRelativePath"))
/** Decoded task-relative path accepted by {@link TaskRelativePath}. */
export type TaskRelativePath = Schema.Schema.Type<typeof TaskRelativePath>

/** Lowercase hexadecimal SHA-256 digest. */
export const Sha256Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).pipe(
  Schema.brand("@better-native/dx-evals/Sha256Digest"),
)
/** Decoded SHA-256 digest accepted by {@link Sha256Digest}. */
export type Sha256Digest = Schema.Schema.Type<typeof Sha256Digest>

/** Lowercase hexadecimal HMAC-SHA256 signature. */
export const HmacSha256Signature = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).pipe(
  Schema.brand("@better-native/dx-evals/HmacSha256Signature"),
)
/** Decoded HMAC-SHA256 signature accepted by {@link HmacSha256Signature}. */
export type HmacSha256Signature = Schema.Schema.Type<typeof HmacSha256Signature>

/** Result states emitted by deterministic and reviewed eval gates. */
export const GateResultStatus = Schema.Literals(["pass", "fail", "unknown", "infrastructure-error"])
/** Decoded gate result state accepted by {@link GateResultStatus}. */
export type GateResultStatus = Schema.Schema.Type<typeof GateResultStatus>

/** Sanitized failure taxonomy safe for reports and authenticated public evidence. */
export const FailureCategory = Schema.Literals([
  "compilation",
  "module-load",
  "provider-protocol",
  "timeout",
  "scenario",
  "source-policy",
  "harness",
])
/** Decoded sanitized failure category accepted by {@link FailureCategory}. */
export type FailureCategory = Schema.Schema.Type<typeof FailureCategory>

/** Bounded failure evidence which never contains candidate output or private grader values. */
export const FailureEvidence = Schema.Struct({
  category: FailureCategory,
  phase: Schema.Literals(["agent", "provider", "sandbox", "verification"]),
  gateId: Schema.optional(GateId),
})
/** Decoded failure evidence accepted by {@link FailureEvidence}. */
export type FailureEvidence = Schema.Schema.Type<typeof FailureEvidence>

/** Version-independent result for one required or diagnostic eval gate. */
export const GateResult = Schema.Struct({
  id: GateId,
  required: Schema.Boolean,
  result: GateResultStatus,
  rationale: Schema.String,
  failureCategory: Schema.optional(FailureCategory),
})
/** Decoded gate result accepted by {@link GateResult}. */
export type GateResult = Schema.Schema.Type<typeof GateResult>

/** Canonical user, system, or assistant message in a trial transcript. */
export const TranscriptMessageEvent = Schema.Struct({
  type: Schema.Literal("message"),
  role: Schema.Literals(["system", "user", "assistant"]),
  content: Schema.Json,
})

/** Canonical tool invocation in a trial transcript. */
export const TranscriptToolCallEvent = Schema.Struct({
  type: Schema.Literal("tool_call"),
  id: ToolCallId,
  name: NonEmptyString,
  arguments: Schema.Record(Schema.String, Schema.Json),
})

/** Canonical result linked to one transcript tool invocation. */
export const TranscriptToolResultEvent = Schema.Struct({
  type: Schema.Literal("tool_result"),
  toolCallId: ToolCallId,
  name: NonEmptyString,
  content: Schema.Json,
})

/** Ordered transcript event accepted at the Vitest Evals normalization boundary. */
export const TranscriptEvent = Schema.Union([
  TranscriptMessageEvent,
  TranscriptToolCallEvent,
  TranscriptToolResultEvent,
])
/** Decoded transcript event accepted by {@link TranscriptEvent}. */
export type TranscriptEvent = Schema.Schema.Type<typeof TranscriptEvent>

/** Provider and tool usage observed for one trial when available. */
export const UsageSummary = Schema.Struct({
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  reasoningTokens: Schema.optional(Schema.Number),
  cachedInputTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  toolCalls: Schema.optional(Schema.Number),
  retries: Schema.optional(Schema.Number),
  turns: Schema.optional(Schema.Number),
  compactions: Schema.optional(Schema.Number),
  compactionInputTokens: Schema.optional(Schema.Number),
  compactionOutputTokens: Schema.optional(Schema.Number),
  compactionReasoningTokens: Schema.optional(Schema.Number),
  compactionTotalTokens: Schema.optional(Schema.Number),
  compactionCostUsd: Schema.optional(Schema.Number),
  compactionEstimatedTokensBefore: Schema.optional(Schema.Number),
  compactionEstimatedTokensAfter: Schema.optional(Schema.Number),
  costUsd: Schema.optional(Schema.Number),
  providerFingerprint: Schema.optional(Schema.String),
})
/** Decoded usage summary accepted by {@link UsageSummary}. */
export type UsageSummary = Schema.Schema.Type<typeof UsageSummary>

/** Versioned input supplied to exactly one eval harness invocation. */
export const TrialInput = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: RunId,
  taskId: TaskId,
  taskVersion: TaskVersion,
  adapterId: AdapterId,
  agentProfileId: Schema.optional(AgentProfileId),
})
/** Decoded trial input accepted by {@link TrialInput}. */
export type TrialInput = Schema.Schema.Type<typeof TrialInput>
/** Unbranded representation accepted at the external harness boundary. */
export type TrialInputEncoded = Schema.Codec.Encoded<typeof TrialInput>

/** Public evidence state exposed to reports without publication authority. */
export const PublicEvidence = Schema.Union([
  Schema.Struct({ status: Schema.Literal("unavailable") }),
  Schema.Struct({
    status: Schema.Literal("process-authenticated"),
    digest: Sha256Digest,
  }),
])
/** Decoded public evidence state accepted by {@link PublicEvidence}. */
export type PublicEvidence = Schema.Schema.Type<typeof PublicEvidence>

/** Complete reporter-facing outcome constructed for one trial. */
export const TrialOutcome = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: RunId,
  taskId: TaskId,
  infrastructureStatus: Schema.Literals(["valid", "infrastructure-error"]),
  taskSuccess: Schema.Boolean,
  failureEvidence: Schema.Array(FailureEvidence),
  requiredGates: Schema.Array(GateResult),
  transcript: Schema.Array(TranscriptEvent),
  usage: UsageSummary,
  agentExitReason: Schema.optional(
    Schema.Literals([
      "submitted",
      "model-finished",
      "turn-limit",
      "token-limit",
      "cost-limit",
      "cost-unavailable",
      "duration-limit",
    ]),
  ),
  publicEvidence: PublicEvidence,
})
/** Decoded trial outcome accepted by {@link TrialOutcome}. */
export type TrialOutcome = Schema.Schema.Type<typeof TrialOutcome>

/** Effectful decoder for untrusted trial input. */
export const decodeTrialInput = Schema.decodeUnknownEffect(TrialInput)
/** Effectful decoder for a trial outcome crossing an external boundary. */
export const decodeTrialOutcome = Schema.decodeUnknownEffect(TrialOutcome)
/** Synchronous decoder used by deterministic Vitest assertions. */
export const decodeTrialOutcomeSync = Schema.decodeUnknownSync(TrialOutcome)
