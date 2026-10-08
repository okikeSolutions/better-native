import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Isolation from "./Isolation.ts"

/** Failure raised when verifier-owned protocol output is absent or ambiguous. */
export class VerificationInvalid extends Schema.TaggedError<VerificationInvalid>()(
  "VerificationInvalid",
  {
    reason: Schema.String,
  },
) {
  override get message(): string {
    return this.reason
  }
}

const marker = "BETTER_NATIVE_OBSERVATION:"

/** Parses the single authenticated observation envelope emitted by an isolated runner. */
export const parseObservation = Effect.fn("DxEvals.Verifier.parseObservation")(function* (
  observation: Isolation.IsolationObservation,
) {
  if (observation.truncated) {
    return yield* new VerificationInvalid({ reason: "truncated-isolation-output" })
  }
  const authenticatedMarker = `${marker}${observation.authenticationNonce}:`
  const marked = observation.stdout
    .split("\n")
    .filter((line) => line.startsWith(authenticatedMarker))
  const envelope = marked[0]
  if (observation.exitCode !== 0 || marked.length !== 1 || envelope === undefined) {
    return yield* new VerificationInvalid({
      reason: `invalid-observation-envelope:exit=${observation.exitCode}:stdout=${JSON.stringify(observation.stdout)}:stderr=${JSON.stringify(observation.stderr)}`,
    })
  }
  return yield* Effect.try({
    try: () => JSON.parse(envelope.slice(authenticatedMarker.length)) as unknown,
    catch: () => new VerificationInvalid({ reason: "malformed-observation-json" }),
  })
})
