import * as Context from "effect/Context"
import * as Schema from "effect/Schema"

export const BuildIdentity = Schema.Struct({
  mode: Schema.Literals(["upstream", "candidate"]),
  buildId: Schema.NonEmptyString,
})

export type BuildIdentity = Schema.Schema.Type<typeof BuildIdentity>

export class CompatibilityConfiguration extends Context.Service<
  CompatibilityConfiguration,
  BuildIdentity
>()("@better-native/compatibility-suite/CompatibilityConfiguration") {}
