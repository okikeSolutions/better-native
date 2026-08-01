import { Network, NetworkLive } from "@effect-expo/network"
import type * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as ManagedRuntime from "effect/ManagedRuntime"

export interface NetworkRuntimeLease {
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, Network>) => Fiber.Fiber<A, E>
  readonly interrupt: (fiber: Fiber.Fiber<unknown, unknown>) => void
  readonly release: () => void
}

interface SharedRuntime {
  readonly runtime: ManagedRuntime.ManagedRuntime<Network, never>
  leases: number
}

let sharedRuntime: SharedRuntime | undefined

const reportDisposalFailure = (cause: unknown): void => {
  console.error("effect-expo Network runtime disposal failed", cause)
}

/**
 * Acquires the application-owned Network runtime.
 *
 * Leases make React Strict Mode's setup-cleanup-setup cycle safe: the final
 * release disposes the old runtime, and a subsequent setup receives a fresh one.
 */
export const acquireNetworkRuntime = (): NetworkRuntimeLease => {
  const shared =
    sharedRuntime ??
    (sharedRuntime = {
      runtime: ManagedRuntime.make(NetworkLive),
      leases: 0
    })
  shared.leases += 1
  let released = false

  return {
    runFork: (effect) => shared.runtime.runFork(effect),
    interrupt: (fiber) => {
      shared.runtime.runFork(Fiber.interrupt(fiber))
    },
    release: () => {
      if (released) return
      released = true
      shared.leases -= 1
      if (shared.leases === 0) {
        if (sharedRuntime === shared) sharedRuntime = undefined
        void shared.runtime.dispose().catch(reportDisposalFailure)
      }
    }
  }
}
