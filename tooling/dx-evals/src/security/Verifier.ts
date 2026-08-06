import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type * as Isolation from "./Isolation.ts"

/** Failure raised when verifier-owned protocol output is absent or ambiguous. */
export class VerificationInvalid extends Data.TaggedError("VerificationInvalid")<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

const marker = "BETTER_NATIVE_OBSERVATION:"

/** Parses the single authenticated observation envelope emitted by an isolated runner. */
export const parseObservation = (
  observation: Isolation.IsolationObservation,
): Effect.Effect<unknown, VerificationInvalid> =>
  Effect.gen(function* () {
    yield* Match.value(observation.truncated).pipe(
      Match.when(true, () =>
        Effect.fail(new VerificationInvalid({ reason: "truncated-isolation-output" })),
      ),
      Match.when(false, () => Effect.void),
      Match.exhaustive,
    )
    const authenticatedMarker = `${marker}${observation.authenticationNonce}:`
    const marked = observation.stdout
      .split("\n")
      .filter((line) => line.startsWith(authenticatedMarker))
    yield* Match.value({
      exitCode: observation.exitCode,
      envelopeCount: marked.length,
    }).pipe(
      Match.when({ exitCode: 0, envelopeCount: 1 }, () => Effect.void),
      Match.orElse(() =>
        Effect.fail(
          new VerificationInvalid({
            reason: `invalid-observation-envelope:exit=${observation.exitCode}:stdout=${JSON.stringify(observation.stdout)}:stderr=${JSON.stringify(observation.stderr)}`,
          }),
        ),
      ),
    )
    return yield* Effect.try({
      try: () => JSON.parse(marked[0]!.slice(authenticatedMarker.length)) as unknown,
      catch: () => new VerificationInvalid({ reason: "malformed-observation-json" }),
    })
  })
