import * as Schema from "effect/Schema"

/** A deterministic failure at the compatibility boundary. */
export class HarnessError extends Schema.TaggedError<HarnessError>()("HarnessError", {
  operation: Schema.String,
  path: Schema.optional(Schema.String),
  cause: Schema.Defect(),
}) {}
