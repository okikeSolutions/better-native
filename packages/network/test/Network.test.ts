import { describe, expect, it, vi } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

vi.mock("expo-network", () => ({
  NetworkStateType: {
    NONE: "NONE",
    UNKNOWN: "UNKNOWN",
    CELLULAR: "CELLULAR",
    WIFI: "WIFI",
    BLUETOOTH: "BLUETOOTH",
    ETHERNET: "ETHERNET",
    WIMAX: "WIMAX",
    VPN: "VPN",
    OTHER: "OTHER",
  },
  getNetworkStateAsync: vi.fn(),
  getIpAddressAsync: vi.fn(),
  isAirplaneModeEnabledAsync: vi.fn(),
  addNetworkStateListener: vi.fn(),
  useNetworkState: vi.fn(),
}))

const ExpoNetwork = await import("expo-network")
const { Network, NetworkFailure, NetworkService, NetworkStateType } = await import("../src/index")

describe("@better-native/network", () => {
  it("reads network state through an Effect service", async () => {
    const TestNetwork = Layer.succeed(
      NetworkService,
      NetworkService.of({
        getState: Effect.succeed({
          type: NetworkStateType.WIFI,
          isConnected: true,
          isInternetReachable: true,
        }),
        getIpAddress: Effect.succeed("127.0.0.1"),
        isAirplaneModeEnabled: Effect.succeed(false),
        stateChanges: Stream.fromArray([
          {
            type: NetworkStateType.WIFI,
            isConnected: true,
            isInternetReachable: true,
          },
        ]),
      }),
    )

    const result = await Effect.runPromise(Network.getState.pipe(Effect.provide(TestNetwork)))

    expect(result).toEqual({
      type: "WIFI",
      isConnected: true,
      isInternetReachable: true,
    })
  })

  it("exports an Effect atom for React integrations", () => {
    expect(Network.stateAtom).toBeDefined()
  })

  it("reads IP address through an Effect service", async () => {
    const TestNetwork = Layer.succeed(
      NetworkService,
      NetworkService.of({
        getState: Effect.succeed({}),
        getIpAddress: Effect.succeed("127.0.0.1"),
        isAirplaneModeEnabled: Effect.succeed(false),
        stateChanges: Stream.fromArray([
          {
            type: NetworkStateType.WIFI,
            isConnected: true,
            isInternetReachable: true,
          },
        ]),
      }),
    )

    await expect(
      Effect.runPromise(Network.getIpAddress.pipe(Effect.provide(TestNetwork))),
    ).resolves.toBe("127.0.0.1")
  })

  it("preserves Expo native-unavailable failures", async () => {
    vi.mocked(ExpoNetwork.getNetworkStateAsync).mockRejectedValueOnce(
      Object.assign(new Error("not available"), { code: "ERR_UNAVAILABLE" }),
    )

    const exit = await Effect.runPromiseExit(Network.getState.pipe(Effect.provide(Network.live)))

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      if (reason === undefined) throw new Error("expected a failure reason")
      expect(Cause.isFailReason(reason)).toBe(true)
      if (Cause.isFailReason(reason)) {
        expect(reason.error._tag).toBe("NetworkUnavailable")
        expect(reason.error.method).toBe("getNetworkStateAsync")
      }
    }
  })

  it("preserves generic Expo failures separately from unavailable APIs", async () => {
    vi.mocked(ExpoNetwork.getNetworkStateAsync).mockRejectedValueOnce(new Error("network failed"))

    const exit = await Effect.runPromiseExit(Network.getState.pipe(Effect.provide(Network.live)))

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason).toBeDefined()
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(NetworkFailure)
        expect(reason.error.method).toBe("getNetworkStateAsync")
      } else {
        throw new Error("expected a NetworkFailure")
      }
    }
  })

  it("rejects malformed Expo network-state payloads", async () => {
    const networkState = {
      type: NetworkStateType.WIFI,
      isConnected: true,
      isInternetReachable: true,
    }
    vi.mocked(ExpoNetwork.getNetworkStateAsync).mockResolvedValueOnce(
      new Proxy(networkState, {
        get: (target, property, receiver) =>
          property === "type" ? "NOT_A_NETWORK_TYPE" : Reflect.get(target, property, receiver),
      }),
    )

    const exit = await Effect.runPromiseExit(Network.getState.pipe(Effect.provide(Network.live)))

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason).toBeDefined()
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(NetworkFailure)
        expect(reason.error.method).toBe("getNetworkStateAsync")
      } else {
        throw new Error("expected a NetworkFailure")
      }
    }
  })

  it("reads airplane-mode state through the live Expo service", async () => {
    vi.mocked(ExpoNetwork.isAirplaneModeEnabledAsync).mockResolvedValueOnce(false)

    await expect(
      Effect.runPromise(Network.isAirplaneModeEnabled.pipe(Effect.provide(Network.live))),
    ).resolves.toBe(false)
  })

  it("streams network state changes through an Effect service", async () => {
    const TestNetwork = Layer.succeed(
      NetworkService,
      NetworkService.of({
        getState: Effect.succeed({}),
        getIpAddress: Effect.succeed("127.0.0.1"),
        isAirplaneModeEnabled: Effect.succeed(false),
        stateChanges: Stream.fromArray([
          {
            type: NetworkStateType.WIFI,
            isConnected: true,
            isInternetReachable: true,
          },
        ]),
      }),
    )

    const result = await Effect.runPromise(
      Network.stateChanges.pipe(Stream.take(1), Stream.runCollect, Effect.provide(TestNetwork)),
    )

    expect(Array.from(result)).toEqual([
      {
        type: NetworkStateType.WIFI,
        isConnected: true,
        isInternetReachable: true,
      },
    ])
  })

  it("wraps Expo network listeners as scoped streams", async () => {
    const remove = vi.fn()
    vi.mocked(ExpoNetwork.addNetworkStateListener).mockImplementation((listener) => {
      listener({
        type: NetworkStateType.WIFI,
        isConnected: true,
        isInternetReachable: true,
      })
      return { remove }
    })

    const result = await Effect.runPromise(
      Network.stateChanges.pipe(Stream.take(1), Stream.runCollect, Effect.provide(Network.live)),
    )

    expect(Array.from(result)).toEqual([
      {
        type: NetworkStateType.WIFI,
        isConnected: true,
        isInternetReachable: true,
      },
    ])
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("fails when the native network listener cannot be registered", async () => {
    vi.mocked(ExpoNetwork.addNetworkStateListener).mockImplementationOnce(() => {
      throw new Error("listener failed")
    })

    const exit = await Effect.runPromiseExit(
      Network.stateChanges.pipe(Stream.take(1), Stream.runCollect, Effect.provide(Network.live)),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason).toBeDefined()
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(NetworkFailure)
        expect(reason.error.method).toBe("addNetworkStateListener")
      } else {
        throw new Error("expected a NetworkFailure")
      }
    }
  })

  it("updates the live atom from network events and releases its subscription", async () => {
    let state = {
      type: NetworkStateType.WIFI,
      isConnected: true,
      isInternetReachable: true,
    }
    let listener: ((event: typeof state) => void) | undefined
    const remove = vi.fn()
    vi.mocked(ExpoNetwork.getNetworkStateAsync).mockImplementation(() => Promise.resolve(state))
    vi.mocked(ExpoNetwork.addNetworkStateListener).mockImplementation((callback) => {
      listener = callback
      return { remove }
    })
    const registry = AtomRegistry.make()
    const cancel = registry.mount(Network.stateAtom)
    const value = () => {
      const result = registry.get(Network.stateAtom)
      if (!AsyncResult.isSuccess(result)) throw new Error("expected atom value")
      return result.value
    }

    expect(value()).toEqual({})
    await vi.waitFor(() => {
      expect(value()).toEqual(state)
      expect(listener).toBeDefined()
    })

    state = {
      type: NetworkStateType.NONE,
      isConnected: false,
      isInternetReachable: false,
    }
    listener?.(state)
    await vi.waitFor(() => expect(value()).toEqual(state))

    cancel()
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
  })
})
