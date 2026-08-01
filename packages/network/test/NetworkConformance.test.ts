import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import {
  beginNetworkChangesResubscription,
  beginNetworkChangesSession,
  confirmNetworkChangesScopeFinalization,
  failNetworkChangesSession,
  finishNetworkChangesStop,
  observeNetworkChangesSession,
  runNetworkChangesConformance,
  runNetworkConformance,
  stopNetworkChangesSession,
  type NetworkChangesConformanceDriver
} from "../src/conformance/NetworkConformance.ts"
import { offline, type NetworkState } from "../src/contracts/NetworkContract.ts"
import { type NativeNetwork, layerFromNative } from "../src/adapters/NetworkAdapter.ts"
import { Network } from "../src/generated/Network.ts"
import * as NetworkTest from "../src/testing/NetworkTest.ts"

const nativeChangesHarness = (): {
  readonly native: NativeNetwork
  readonly driver: NetworkChangesConformanceDriver
} => {
  const listeners = new Set<(state: unknown) => void>()
  const waiters = new Set<{
    readonly minimum: number
    readonly resume: (effect: Effect.Effect<void>) => void
  }>()
  let registrations = 0
  let removals = 0

  const notifyWaiters = (): void => {
    for (const waiter of waiters) {
      if (registrations >= waiter.minimum) {
        waiters.delete(waiter)
        waiter.resume(Effect.void)
      }
    }
  }

  return {
    native: {
      getNetworkStateAsync: async () => offline,
      addNetworkStateListener: (listener) => {
        listeners.add(listener)
        registrations += 1
        notifyWaiters()
        return {
          remove() {
            if (listeners.delete(listener)) removals += 1
          }
        }
      }
    },
    driver: {
      emit: (state) =>
        Effect.sync(() => {
          for (const listener of listeners) listener(state)
        }),
      registrations: Effect.sync(() => registrations),
      removals: Effect.sync(() => removals),
      awaitRegistrations: (minimum) =>
        Effect.callback<void>((resume) => {
          if (registrations >= minimum) {
            resume(Effect.void)
            return
          }
          const waiter = { minimum, resume }
          waiters.add(waiter)
          return Effect.sync(() => {
            waiters.delete(waiter)
          })
        })
    }
  }
}

describe("@effect-expo/network shared conformance", () => {
  it.effect("passes the upstream-derived vectors against the deterministic Layer", () =>
    Effect.gen(function* () {
      const results = yield* runNetworkConformance
      expect(results.every((result) => result.status === "passed")).toBe(true)
    }).pipe(Effect.provide(NetworkTest.layer(offline)))
  )

  it.effect("allows an unknown transport to report connectivity", () =>
    Effect.gen(function* () {
      const results = yield* runNetworkConformance
      expect(results.every((result) => result.status === "passed")).toBe(true)
    }).pipe(
      Effect.provide(
        NetworkTest.layer({
          type: "UNKNOWN",
          isConnected: true,
          isInternetReachable: true
        })
      )
    )
  )

  it.effect("passes the same vectors through the reviewed adapter boundary", () =>
    Effect.gen(function* () {
      const results = yield* runNetworkConformance
      expect(results.every((result) => result.status === "passed")).toBe(true)
    }).pipe(
      Effect.provide(
        layerFromNative({
          getNetworkStateAsync: async () => offline,
          addNetworkStateListener: () => ({ remove() {} })
        })
      )
    )
  )

  it.effect("fails the connectivity vector for a semantically invalid implementation", () => {
    const invalidLayer = Layer.succeed(Network)({
      current: Effect.succeed({
        type: "NONE",
        isConnected: true,
        isInternetReachable: false
      }),
      changes: Stream.empty
    })

    return Effect.gen(function* () {
      const results = yield* runNetworkConformance
      expect(results).toEqual([
        expect.objectContaining({ id: "network.current.shape", status: "passed" }),
        expect.objectContaining({
          id: "network.current.connectivity-semantics",
          status: "failed"
        })
      ])
    }).pipe(Effect.provide(invalidLayer))
  })

  it.effect("accepts independently reported reachability for a non-NONE transport", () => {
    const independentLayer = Layer.succeed(Network)({
      current: Effect.succeed({
        type: "WIFI",
        isConnected: false,
        isInternetReachable: true
      }),
      changes: Stream.empty
    })

    return Effect.gen(function* () {
      const results = yield* runNetworkConformance
      expect(results).toContainEqual(
        expect.objectContaining({
          id: "network.current.connectivity-semantics",
          status: "passed"
        })
      )
    }).pipe(Effect.provide(independentLayer))
  })

  it.effect("fails the shape vector for an unknown connection type", () => {
    const invalidLayer = Layer.succeed(Network)({
      current: Effect.succeed({
        type: "SATELLITE",
        isConnected: true,
        isInternetReachable: true
      } as unknown as NetworkState),
      changes: Stream.empty
    })

    return Effect.gen(function* () {
      const results = yield* runNetworkConformance
      expect(results).toContainEqual(
        expect.objectContaining({ id: "network.current.shape", status: "failed" })
      )
    }).pipe(Effect.provide(invalidLayer))
  })

  it.effect("passes future-only listener vectors through the deterministic Layer", () =>
    Effect.gen(function* () {
      const controller = yield* NetworkTest.NetworkTestController
      const results = yield* runNetworkChangesConformance({
        emit: controller.set,
        registrations: controller.registrations,
        removals: controller.removals,
        awaitRegistrations: controller.awaitRegistrations
      })

      expect(results.every((result) => result.status === "passed")).toBe(true)
    }).pipe(Effect.provide(NetworkTest.layer(offline)))
  )

  it.effect("passes the same listener vectors through the reviewed native adapter", () => {
    const harness = nativeChangesHarness()
    return Effect.gen(function* () {
      const results = yield* runNetworkChangesConformance(harness.driver)
      expect(results.every((result) => result.status === "passed")).toBe(true)
    }).pipe(Effect.provide(layerFromNative(harness.native)))
  })

  it("keeps interactive native vectors pending until distinct OS events are observed", () => {
    const first = { type: "WIFI", isConnected: true, isInternetReachable: false } as const
    const second = { ...first, isInternetReachable: true }

    const started = beginNetworkChangesSession()
    const afterFirst = observeNetworkChangesSession(started, first)
    const afterDuplicate = observeNetworkChangesSession(afterFirst, first)
    const afterSecond = observeNetworkChangesSession(afterDuplicate, second)
    const afterCleanup = confirmNetworkChangesScopeFinalization(afterSecond)
    const resubscribed = beginNetworkChangesResubscription(afterCleanup)
    const complete = observeNetworkChangesSession(resubscribed, first)

    expect(started.results.every((item) => item.status === "pending")).toBe(true)
    expect(afterFirst.phase).toBe("awaiting-subsequent")
    expect(afterDuplicate).toBe(afterFirst)
    expect(afterSecond.phase).toBe("ready-to-cleanup")
    expect(afterCleanup.phase).toBe("ready-to-resubscribe")
    expect(resubscribed.phase).toBe("awaiting-resubscribed")
    expect(complete.phase).toBe("complete")
    expect(complete.results.map((item) => [item.id, item.status])).toEqual([
      ["network.changes.first-delivery", "passed"],
      ["network.changes.subsequent-delivery", "passed"],
      ["network.changes.scope-finalization", "passed"],
      ["network.changes.resubscribe", "passed"]
    ])
  })

  it("marks only the currently pending interactive vector failed", () => {
    const failed = failNetworkChangesSession(
      beginNetworkChangesSession(),
      "No native event observed"
    )
    expect(failed.phase).toBe("failed")
    expect(failed.results).toContainEqual(
      expect.objectContaining({
        id: "network.changes.first-delivery",
        status: "failed",
        detail: "No native event observed"
      })
    )
    expect(failed.results.filter((item) => item.status === "pending")).toHaveLength(3)
  })

  it("keeps a stopped session non-restartable until its owned fiber exits", () => {
    const stopping = stopNetworkChangesSession(
      beginNetworkChangesSession(),
      "Stopped by the operator"
    )
    const finished = finishNetworkChangesStop(stopping)

    expect(stopping.phase).toBe("stopping")
    expect(finished.phase).toBe("failed")
    expect(finished.results).toContainEqual(
      expect.objectContaining({
        id: "network.changes.first-delivery",
        status: "failed",
        detail: "Stopped by the operator"
      })
    )
  })
})
