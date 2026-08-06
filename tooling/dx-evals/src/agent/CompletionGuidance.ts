import * as Match from "effect/Match"
import type * as Domain from "../Domain.ts"
import * as CodingTools from "./tools/index.ts"

type CompileStatus = "passed" | "failed" | "timeout" | "unavailable"

interface CandidateState {
  readonly changed: boolean
  readonly compileStatus?: CompileStatus
  readonly compileIsStale: boolean
}

const successfulMutation = (event: Domain.TranscriptEvent): boolean =>
  Match.value(event).pipe(
    Match.when(
      { type: "tool_result", name: Match.any },
      (result) =>
        (result.name === "edit" || result.name === "write") &&
        typeof result.content === "object" &&
        result.content !== null &&
        "ok" in result.content &&
        result.content.ok === true,
    ),
    Match.orElse(() => false),
  )

const compileStatus = (event: Domain.TranscriptEvent): CompileStatus | undefined =>
  Match.value(event).pipe(
    Match.when({ type: "tool_result", name: "check_submission" }, (result) => {
      if (
        typeof result.content !== "object" ||
        result.content === null ||
        !("status" in result.content)
      ) {
        return undefined
      }
      const status = result.content.status
      return status === "passed" ||
        status === "failed" ||
        status === "timeout" ||
        status === "unavailable"
        ? status
        : undefined
    }),
    Match.orElse(() => undefined),
  )

const candidateState = (
  workspace: CodingTools.WorkspaceState,
  transcript: ReadonlyArray<Domain.TranscriptEvent>,
): CandidateState => {
  let latestMutation = -1
  let latestCheck = -1
  let latestStatus: CompileStatus | undefined
  transcript.forEach((event, index) => {
    if (successfulMutation(event)) latestMutation = index
    const status = compileStatus(event)
    if (status !== undefined) {
      latestCheck = index
      latestStatus = status
    }
  })
  const changed = CodingTools.makeSubmission(workspace).entries.length > 0
  return {
    changed,
    ...(latestStatus === undefined ? {} : { compileStatus: latestStatus }),
    compileIsStale: changed && (latestCheck < 0 || latestMutation > latestCheck),
  }
}

/** Returns evidence-based workflow guidance for the next provider request. */
export const forRequest = (
  turn: number,
  maximumTurns: number,
  workspace: CodingTools.WorkspaceState,
  transcript: ReadonlyArray<Domain.TranscriptEvent>,
  remainingObservedTokens?: number,
  estimatedBilledTokensPerRequest?: number,
): string | undefined => {
  const turnLimitedRequests = maximumTurns - turn
  const tokenLimitedRequests =
    remainingObservedTokens === undefined || estimatedBilledTokensPerRequest === undefined
      ? turnLimitedRequests
      : Math.max(1, Math.floor(remainingObservedTokens / estimatedBilledTokensPerRequest))
  const remainingRequests = Math.min(turnLimitedRequests, tokenLimitedRequests)
  const state = candidateState(workspace, transcript)
  return Match.value({
    remainingRequests,
    changed: state.changed,
    stale: state.compileIsStale,
    status: state.compileStatus ?? "none",
  }).pipe(
    Match.when(
      { changed: true, stale: false, status: "passed" },
      () =>
        "The current candidate passed check_submission and has not changed since. Call submit now.",
    ),
    Match.when(
      { remainingRequests: 1, changed: true, stale: true },
      () =>
        "This is the final available request. The candidate changed after its last compilation. Run check_submission now; do not explore further.",
    ),
    Match.when(
      { remainingRequests: 1, changed: true },
      () =>
        "This is the final available request. Submit the best current candidate now; do not explore further.",
    ),
    Match.when(
      { remainingRequests: 1 },
      () =>
        "This is the final available request. Complete the best current candidate now; do not explore further.",
    ),
    Match.when(
      { changed: true, stale: true },
      ({ remainingRequests: remaining }) =>
        `The candidate changed since its last compilation. Run check_submission next and use its diagnostics. ${remaining} requests remain.`,
    ),
    Match.when(
      { changed: true, status: "failed" },
      ({ remainingRequests: remaining }) =>
        `The current candidate failed check_submission. Fix the reported diagnostics, then compile it again. ${remaining} requests remain.`,
    ),
    Match.when(
      { changed: true, status: "timeout" },
      ({ remainingRequests: remaining }) =>
        `The latest check_submission timed out. Keep the candidate bounded and retry compilation before submitting. ${remaining} requests remain.`,
    ),
    Match.when(
      { changed: true, status: "unavailable" },
      ({ remainingRequests: remaining }) =>
        `Compilation was unavailable. Review the current candidate carefully and submit the best version. ${remaining} requests remain.`,
    ),
    Match.when(
      { remainingRequests: 2 },
      () => "Two requests remain. Stop broad exploration and implement the best candidate now.",
    ),
    Match.when(
      { remainingRequests: 3 },
      () =>
        "Three requests remain. Finish targeted inspection and implement now so compilation and submission still fit.",
    ),
    Match.orElse(() => undefined),
  )
}
