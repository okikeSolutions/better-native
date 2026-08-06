import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

/** Builds a layer in the caller's scope and provides its resulting context. */
export const provideLayer =
  <ROut, E2, RIn>(layer: Layer.Layer<ROut, E2, RIn>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | E2, RIn | Exclude<R, ROut>> =>
    Effect.scoped(
      Layer.build(layer).pipe(Effect.flatMap((context) => Effect.provide(effect, context))),
    )
