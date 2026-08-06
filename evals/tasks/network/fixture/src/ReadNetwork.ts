import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export const NetworkSnapshot = Schema.Unknown

export const readNetwork = Effect.succeed({ status: "not-implemented" })
