import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as AiError from "effect/unstable/ai/AiError"
import * as AgentAdapters from "./agent/AgentAdapters.ts"
import * as Config from "./Config.ts"
import * as Domain from "./Domain.ts"
import * as Evidence from "./evidence/Evidence.ts"
import * as Isolation from "./security/Isolation.ts"
import * as Diagnostics from "./observability/Diagnostics.ts"
import * as TaskWorkspace from "./tasks/TaskWorkspace.ts"

/** Typed failure raised when a caller supplies a malformed trial input. */
export class TrialInputInvalid extends Data.TaggedError("TrialInputInvalid")<{
  readonly cause: Schema.SchemaError
}> {}

/** Typed failure raised when a trial does not select the pinned task revision. */
export class TrialTaskMismatch extends Data.TaggedError("TrialTaskMismatch")<{
  readonly taskId: Domain.TaskId
  readonly taskVersion: Domain.TaskVersion
}> {}

export const gateFailureEvidence = (
  gates: ReadonlyArray<Domain.GateResult>,
): ReadonlyArray<Domain.FailureEvidence> =>
  gates.flatMap((gate) =>
    gate.result === "pass"
      ? []
      : [
          {
            category: gate.failureCategory ?? "scenario",
            phase: "verification" as const,
            gateId: gate.id,
          },
        ],
  )

export const agentCheckFailureEvidence = (
  transcript: ReadonlyArray<Domain.TranscriptEvent>,
): ReadonlyArray<Domain.FailureEvidence> => {
  const evidence: Array<Domain.FailureEvidence> = []
  for (const event of transcript) {
    if (event.type !== "tool_result" || event.name !== "check_submission") continue
    const status = Match.value(event.content).pipe(
      Match.when(Match.record, (record) => Reflect.get(record, "status")),
      Match.orElse(() => undefined),
    )
    const finding = Match.value(status).pipe(
      Match.when("failed", () => ({ category: "compilation", phase: "agent" }) as const),
      Match.when("timeout", () => ({ category: "timeout", phase: "agent" }) as const),
      Match.orElse(() => undefined),
    )
    if (finding !== undefined) evidence.push(finding)
  }
  return evidence
}

export const infrastructureFailureEvidence = (error: unknown): Domain.FailureEvidence =>
  Match.value(error).pipe(
    Match.when(Match.instanceOf(AiError.AiError), () => ({
      category: "provider-protocol" as const,
      phase: "provider" as const,
    })),
    Match.when(Match.instanceOf(Isolation.IsolationFailure), (failure) => ({
      category: failure.reason === "timeout" ? ("timeout" as const) : ("harness" as const),
      phase: "sandbox" as const,
    })),
    Match.orElse(() => ({
      category: "harness" as const,
      phase: "verification" as const,
    })),
  )

const jsonType = (value: unknown): string =>
  Match.value({ isNull: value === null, isArray: Array.isArray(value) }).pipe(
    Match.when({ isNull: true }, () => "null"),
    Match.when({ isArray: true }, () => "array"),
    Match.orElse(() => typeof value),
  )

/** Value-free local diagnostics for debugging reportable infrastructure failures. */
export const infrastructureFailureLogAnnotations = (
  error: AiError.AiError | Isolation.IsolationFailure,
): Readonly<Record<string, unknown>> =>
  Match.value(error).pipe(
    Match.when(Match.instanceOf(AiError.AiError), (failure) => ({
      failureCategory: "provider-protocol",
      providerErrorType: failure.reason._tag,
      ...(failure.reason._tag === "ToolParameterValidationError"
        ? {
            providerToolName: failure.reason.toolName,
            providerToolParameterShape:
              typeof failure.reason.toolParams === "object" &&
              failure.reason.toolParams !== null &&
              !Array.isArray(failure.reason.toolParams)
                ? Object.fromEntries(
                    Object.entries(failure.reason.toolParams)
                      .sort(([left], [right]) => left.localeCompare(right))
                      .map(([key, value]) => [key, jsonType(value)]),
                  )
                : {},
          }
        : {}),
    })),
    Match.when(Match.instanceOf(Isolation.IsolationFailure), (failure) => ({
      failureCategory: failure.reason === "timeout" ? "timeout" : "harness",
      sandboxFailureReason: failure.reason,
    })),
    Match.orElse(() => ({ failureCategory: "harness" })),
  )

const infrastructureOutcome = (input: Domain.TrialInput, error: unknown): Domain.TrialOutcome => ({
  schemaVersion: 1,
  runId: input.runId,
  taskId: input.taskId,
  infrastructureStatus: "infrastructure-error",
  taskSuccess: false,
  failureEvidence: [infrastructureFailureEvidence(error)],
  requiredGates: [],
  transcript: [
    {
      type: "message",
      role: "system",
      content: "Trial stopped before trusted task verification completed.",
    },
  ],
  usage: {},
  publicEvidence: { status: "unavailable" },
})

const isReportableInfrastructureFailure = (
  error: unknown,
): error is AiError.AiError | Isolation.IsolationFailure =>
  error instanceof AiError.AiError || error instanceof Isolation.IsolationFailure

/**
 * Validates and executes one trial through the configured adapter registry.
 *
 * @param untrustedInput - Unknown value received at the custom-harness boundary.
 * @returns An Effect producing the complete foundation trial outcome.
 */
export const runTrial = Effect.fn("DxEvals.runTrial")(function* (untrustedInput: unknown) {
  const input = yield* Domain.decodeTrialInput(untrustedInput).pipe(
    Effect.mapError((cause) => new TrialInputInvalid({ cause })),
  )
  return yield* Effect.gen(function* () {
    yield* Effect.logInfo("Trial started")
    const adapters = yield* AgentAdapters.AgentAdapters
    const task = yield* TaskWorkspace.loadTask(input.taskId)
    if (input.taskId !== task.definition.id || input.taskVersion !== task.definition.version) {
      return yield* new TrialTaskMismatch({
        taskId: input.taskId,
        taskVersion: input.taskVersion,
      })
    }
    const adapterResult = yield* adapters.run(input.adapterId, input)
    yield* Effect.logInfo("Agent execution completed").pipe(
      Effect.annotateLogs({
        exitReason: adapterResult.exitReason ?? "not-applicable",
        turns: adapterResult.usage.turns ?? 0,
      }),
    )
    const verification = yield* task.verify(adapterResult.submission)
    const taskSuccess = verification.gates
      .filter((gate) => gate.required)
      .every((gate) => gate.result === "pass")
    const failureEvidence = [
      ...agentCheckFailureEvidence(adapterResult.transcript),
      ...gateFailureEvidence(verification.gates),
    ]
    const reportGates = verification.gates.map((gate) => {
      const failureCategory = "failureCategory" in gate ? gate.failureCategory : undefined
      return {
        id: gate.id,
        required: gate.required,
        result: gate.result,
        rationale: gate.rationale,
        ...(failureCategory === undefined ? {} : { failureCategory }),
      }
    })
    const passedGateCount = verification.gates.filter((gate) => gate.result === "pass").length
    yield* Effect.logInfo("Trial verification completed").pipe(
      Effect.annotateLogs({
        gateCount: verification.gates.length,
        passedGateCount,
      }),
    )
    const taskExport = TaskWorkspace.exportTask(task)
    const evidence = yield* Evidence.Evidence
    const config = yield* Config.DxEvalConfig
    const digests = yield* Effect.all({
      instruction: evidence.digest(task.instruction),
      evaluatorBundle: evidence.digest(task.evaluatorBundle),
      taskExport: evidence.digest(taskExport),
      submission: evidence.digest(adapterResult.submission),
      observation: evidence.digest(verification.observation),
      gates: evidence.digest(verification.gates),
    })
    const signedEvidence = yield* evidence.seal({
      schemaVersion: 1,
      runId: input.runId,
      taskId: input.taskId,
      taskVersion: input.taskVersion,
      adapterId: input.adapterId,
      instructionDigest: digests.instruction,
      evaluatorBundleDigest: digests.evaluatorBundle,
      taskExportDigest: digests.taskExport,
      submissionDigest: digests.submission,
      observationDigest: digests.observation,
      gateDigest: digests.gates,
      taskSuccess,
      failureEvidence,
      isolationPolicy: {
        image: config.sandboxImage,
        timeoutMilliseconds: config.sandboxTimeoutMilliseconds,
        network: "none",
        filesystem: "read-only",
        user: "65532:65532",
      },
      ...(adapterResult.agentProfile === undefined
        ? {}
        : { agentProfile: adapterResult.agentProfile }),
      usage: adapterResult.usage,
      ...(adapterResult.exitReason === undefined
        ? {}
        : { agentExitReason: adapterResult.exitReason }),
    })
    const evidencePath = yield* Evidence.persist(input.runId, signedEvidence)
    yield* Effect.logInfo("Trial evidence persisted").pipe(Effect.annotateLogs({ evidencePath }))

    return {
      schemaVersion: 1,
      runId: input.runId,
      taskId: input.taskId,
      infrastructureStatus: "valid",
      taskSuccess,
      failureEvidence,
      requiredGates: verification.gates,
      transcript: [
        ...adapterResult.transcript,
        {
          type: "tool_call",
          id: Domain.ToolCallId.make(`verify-${task.taskType}-1`),
          name: verification.toolName,
          arguments: { taskId: input.taskId },
        },
        {
          type: "tool_result",
          toolCallId: Domain.ToolCallId.make(`verify-${task.taskType}-1`),
          name: verification.toolName,
          content: {
            passed: verification.gates.every((gate) => gate.result === "pass"),
            gates: reportGates,
          },
        },
      ],
      usage: adapterResult.usage,
      ...(adapterResult.exitReason === undefined
        ? {}
        : { agentExitReason: adapterResult.exitReason }),
      publicEvidence: {
        status: "process-authenticated",
        digest: signedEvidence.digest,
      },
    } satisfies Domain.TrialOutcome
  }).pipe(
    Effect.catch((error) =>
      isReportableInfrastructureFailure(error)
        ? Match.value(error).pipe(
            Match.when(Match.instanceOf(AiError.AiError), (providerError) =>
              Diagnostics.Diagnostics.pipe(
                Effect.flatMap((diagnostics) => diagnostics.recordProviderFailure(providerError)),
              ),
            ),
            Match.orElse(() => Effect.void),
            Effect.andThen(
              Effect.logWarning("Trial stopped by reportable infrastructure failure").pipe(
                Effect.annotateLogs(infrastructureFailureLogAnnotations(error)),
              ),
            ),
            Effect.as(infrastructureOutcome(input, error)),
          )
        : Effect.fail(error),
    ),
    Effect.tap(() => Effect.logInfo("Trial completed")),
    Effect.tapCause(() => Effect.logError("Trial failed")),
    Effect.annotateLogs({
      component: "dx-evals",
      runId: input.runId,
      taskId: input.taskId,
      adapterId: input.adapterId,
      agentProfileId: input.agentProfileId ?? "not-applicable",
    }),
    Effect.withLogSpan("trial"),
  )
})
