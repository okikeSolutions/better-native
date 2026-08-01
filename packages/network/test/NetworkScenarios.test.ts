import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Stream } from "effect"
import { offline, type NetworkState } from "../src/contracts/NetworkContract.ts"
import { Network } from "../src/generated/Network.ts"
import * as NetworkTest from "../src/testing/NetworkTest.ts"

const wifiWithoutInternet: NetworkState = {
  type: "WIFI",
  isConnected: true,
  isInternetReachable: false
}

const wifi: NetworkState = {
  ...wifiWithoutInternet,
  isInternetReachable: true
}

describe("@effect-expo/network deterministic scenarios", () => {
  it.effect("keeps connected and internet-reachable as separate states", () =>
    Effect.gen(function* () {
      const network = yield* Network
      const controller = yield* NetworkTest.NetworkTestController
      const fiber = yield* network.changes.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true })
      )
      yield* controller.awaitRegistrations(1)
      yield* controller.set(wifiWithoutInternet)
      yield* controller.set(wifi)
      const states = yield* Fiber.join(fiber)

      expect(states).toEqual([wifiWithoutInternet, wifi])
      expect(yield* controller.removals).toBe(1)
    }).pipe(Effect.provide(NetworkTest.layer(offline)))
  )

  it.effect("updates the current snapshot", () =>
    Effect.gen(function* () {
      const network = yield* Network
      const controller = yield* NetworkTest.NetworkTestController
      yield* controller.set(wifi)
      const state = yield* network.current

      expect(state).toEqual(wifi)
    }).pipe(Effect.provide(NetworkTest.layer(offline)))
  )
})
