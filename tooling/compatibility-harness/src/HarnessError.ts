import * as Data from "effect/Data"

/** A deterministic failure at the compatibility boundary. */
export class HarnessError extends Data.TaggedError("HarnessError")<{
  readonly operation: string
  readonly path?: string
  readonly cause: unknown
}> {}
