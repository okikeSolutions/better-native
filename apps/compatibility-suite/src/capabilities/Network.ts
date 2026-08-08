import { Network } from "@better-native/network"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as ExpoNetwork from "expo-network"
import { Platform } from "react-native"

export const name = "Network Effect capability"

interface JasmineApi {
  readonly describe: (name: string, spec: () => void) => void
  readonly it: (name: string, spec: () => Promise<void>) => void
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const run = <A, E>(effect: Effect.Effect<A, E, Network.Network>) =>
  // The Jasmine capability module is the application boundary for this independently selected run.
  // oxlint-disable-next-line effecttsgo/strict-effect-provide
  Effect.runPromise(effect.pipe(Effect.provide(Network.live)))

const stableState = (state: Network.NetworkState): string =>
  JSON.stringify({
    type: state.type,
    isConnected: state.isConnected,
    isInternetReachable: state.isInternetReachable,
  })

export function test({ describe, it }: JasmineApi): void {
  describe(name, () => {
    it("reads and validates the current native state through the live layer", async () => {
      const expoState = await ExpoNetwork.getNetworkStateAsync()
      const effectState = await run(Network.getNetworkStateAsync)
      assert(stableState(effectState) === stableState(expoState), "Effect and Expo states differ")
      assert(
        effectState.isConnected === undefined || typeof effectState.isConnected === "boolean",
        "Network connectivity was not boolean or undefined",
      )
      assert(
        effectState.isInternetReachable === undefined ||
          typeof effectState.isInternetReachable === "boolean",
        "Network reachability was not boolean or undefined",
      )
    })

    it("reads a native IPv4 address through the live layer", async () => {
      if (Platform.OS === "web") return
      const [expoAddress, effectAddress] = await Promise.all([
        ExpoNetwork.getIpAddressAsync(),
        run(Network.getIpAddressAsync),
      ])
      const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/
      assert(ipv4.test(expoAddress), `Expo returned an invalid IPv4 address: ${expoAddress}`)
      assert(ipv4.test(effectAddress), `Effect returned an invalid IPv4 address: ${effectAddress}`)
    })

    it("preserves airplane-mode values or typed native unavailability", async () => {
      try {
        const expoValue = await ExpoNetwork.isAirplaneModeEnabledAsync()
        const effectValue = await run(Network.isAirplaneModeEnabledAsync)
        assert(typeof effectValue === "boolean", "Effect airplane-mode result was not boolean")
        assert(effectValue === expoValue, "Effect and Expo airplane-mode results differ")
      } catch (expoCause) {
        const failure = await run(Network.isAirplaneModeEnabledAsync.pipe(Effect.flip))
        assert(
          failure instanceof Network.NetworkUnavailable,
          "Network did not map native unavailability to NetworkUnavailable",
        )
        assert(
          failure.method === "isAirplaneModeEnabledAsync",
          "Network unavailability lost the native method",
        )
        assert(
          typeof expoCause === "object" &&
            expoCause !== null &&
            Reflect.get(expoCause, "code") === "ERR_UNAVAILABLE",
          `Expo failed for an unexpected reason: ${String(expoCause)}`,
        )
      }
    })

    it("acquires and releases the native state stream", async () => {
      await run(
        Effect.gen(function* () {
          const fiber = yield* Network.addNetworkStateListener.pipe(
            Stream.runDrain,
            Effect.forkChild,
          )
          yield* Effect.sleep("100 millis")
          yield* Fiber.interrupt(fiber)
        }),
      )
    })

    it("hydrates and releases the live network atom", async () => {
      const registry = AtomRegistry.make()
      const release = registry.mount(Network.networkStateAtom)
      try {
        const deadline = Date.now() + 3_000
        while (Date.now() < deadline) {
          const result = registry.get(Network.networkStateAtom)
          if (
            AsyncResult.isSuccess(result) &&
            (result.value.type !== undefined || result.value.isConnected !== undefined)
          ) {
            return
          }
          await delay(25)
        }
        throw new Error("Network atom did not hydrate from the live layer")
      } finally {
        release()
      }
    })
  })
}
