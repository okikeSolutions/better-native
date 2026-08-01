/**
 * Deterministic Network test Layers and scenario controls.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import type { NetworkState } from "../contracts/NetworkContract.ts"
import { Network } from "../generated/Network.ts"

/**
 * Controls the state emitted by a deterministic Network test Layer.
 *
 * @category testing
 * @since 0.1.0
 */
export interface NetworkTestController {
  readonly set: (state: NetworkState) => Effect.Effect<void>
  readonly registrations: Effect.Effect<number>
  readonly removals: Effect.Effect<number>
  readonly awaitRegistrations: (minimum: number) => Effect.Effect<void>
}

/**
 * Service tag for controlling a deterministic Network test Layer.
 *
 * @category testing
 * @since 0.1.0
 */
export const NetworkTestController: Context.Service<NetworkTestController, NetworkTestController> =
  Context.Service("@effect-expo/network/NetworkTestController")

/**
 * Creates a deterministic in-memory Network Layer and scenario controller.
 *
 * `current` exposes the supplied snapshot. `changes` emits future calls to
 * `set` only, matching Expo's listener contract without replaying the snapshot.
 * Each invocation owns independent mutable state and should be provided per test.
 *
 * @category testing
 * @since 0.1.0
 */
export const layer = (initial: NetworkState): Layer.Layer<Network | NetworkTestController> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const state = yield* Ref.make(initial)
      const listeners = new Set<(state: NetworkState) => void>()
      const registrationWaiters = new Set<{
        readonly minimum: number
        readonly resume: (effect: Effect.Effect<void>) => void
      }>()
      let registrations = 0
      let removals = 0

      const notifyRegistrationWaiters = (): void => {
        for (const waiter of registrationWaiters) {
          if (registrations >= waiter.minimum) {
            registrationWaiters.delete(waiter)
            waiter.resume(Effect.void)
          }
        }
      }

      const changes = Stream.callback<NetworkState>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const listener = (next: NetworkState): void => {
              Queue.offerUnsafe(queue, next)
            }
            listeners.add(listener)
            registrations += 1
            notifyRegistrationWaiters()
            return listener
          }),
          (listener) =>
            Effect.sync(() => {
              if (listeners.delete(listener)) removals += 1
            })
        )
      )

      return Context.make(Network, {
        current: Ref.get(state),
        changes
      }).pipe(
        Context.add(NetworkTestController, {
          set: (next) =>
            Ref.set(state, next).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  for (const listener of listeners) listener(next)
                })
              )
            ),
          registrations: Effect.sync(() => registrations),
          removals: Effect.sync(() => removals),
          awaitRegistrations: (minimum) =>
            Effect.callback<void>((resume) => {
              if (registrations >= minimum) {
                resume(Effect.void)
                return
              }
              const waiter = { minimum, resume }
              registrationWaiters.add(waiter)
              return Effect.sync(() => {
                registrationWaiters.delete(waiter)
              })
            })
        })
      )
    })
  )
