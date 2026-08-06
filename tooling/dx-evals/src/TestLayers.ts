import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

/** Provides a test Layer with its scope kept alive for the complete test Effect. */
export const provideLayer =
  <ROut, ELayer, RIn>(layer: Layer.Layer<ROut, ELayer, RIn>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R | ROut>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer)
        return yield* effect.pipe(Effect.provide(context))
      }),
    )
