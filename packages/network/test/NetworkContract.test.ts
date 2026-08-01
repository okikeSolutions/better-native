import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Stream } from "effect"
import * as Schema from "effect/Schema"
import {
  NetworkContractViolation,
  NetworkNativeError,
  NetworkState,
  NetworkUnavailable,
  offline
} from "../src/contracts/NetworkContract.ts"
import { type NativeNetwork, layerFromNative } from "../src/adapters/NetworkAdapter.ts"
import { Network } from "../src/generated/Network.ts"

const wifi: NetworkState = {
  type: "WIFI",
  isConnected: true,
  isInternetReachable: true
}

describe("@effect-expo/network adapter contract", () => {
  it.effect("decodes the current native state", () => {
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => wifi,
      addNetworkStateListener: () => ({ remove() {} })
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const result = yield* network.current
      expect(result).toEqual(wifi)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("turns malformed native values into a contract violation", () => {
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => ({ ...offline, isConnected: "no" }),
      addNetworkStateListener: () => ({ remove() {} })
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const error = yield* Effect.flip(network.current)
      expect(error).toBeInstanceOf(NetworkContractViolation)
      expect(error.operation).toBe("current")
      if (!(error instanceof NetworkContractViolation)) return
      expect(error.issue).toContain("isConnected")
      expect("parseError" in error).toBe(false)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("reports an unavailable current-state method", () => {
    const native: NativeNetwork = {
      addNetworkStateListener: () => ({ remove() {} })
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const error = yield* Effect.flip(network.current)
      expect(error).toBeInstanceOf(NetworkUnavailable)
      if (!(error instanceof NetworkUnavailable)) return
      expect(error.operation).toBe("current")
      expect(error.category).toBe("unavailable")
      expect(error.nativeCode).toBeUndefined()
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("classifies a rejected native request", () => {
    const cause = new Error("native request failed")
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => {
        throw cause
      },
      addNetworkStateListener: () => ({ remove() {} })
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const error = yield* Effect.flip(network.current)
      expect(error).toBeInstanceOf(NetworkNativeError)
      if (!(error instanceof NetworkNativeError)) return
      expect(error.operation).toBe("current")
      expect(error.message).toBe("native request failed")
      expect(error.category).toBe("native")
      expect("cause" in error).toBe(false)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("classifies Expo unavailability without relying on an Error subclass", () => {
    const cause = { code: "ERR_UNAVAILABLE", message: "method unavailable" }
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => Promise.reject(cause),
      addNetworkStateListener: () => ({ remove() {} })
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const error = yield* Effect.flip(network.current)
      expect(error).toBeInstanceOf(NetworkUnavailable)
      if (!(error instanceof NetworkUnavailable)) return
      expect(error.operation).toBe("current")
      expect(error.category).toBe("unavailable")
      expect(error.nativeCode).toBe("ERR_UNAVAILABLE")
      expect("cause" in error).toBe(false)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("bounds and sanitizes the public native message without retaining the cause", () => {
    const cause = new Error(`native\n${"x".repeat(400)}`)
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => Promise.reject(cause),
      addNetworkStateListener: () => ({ remove() {} })
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const error = yield* Effect.flip(network.current)
      expect(error).toBeInstanceOf(NetworkNativeError)
      if (!(error instanceof NetworkNativeError)) return
      expect(error.message).not.toContain("\n")
      expect(error.message.length).toBeLessThanOrEqual(256)
      expect("cause" in error).toBe(false)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("rejects unknown native connection types", () => {
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => ({ ...offline, type: "SATELLITE" }),
      addNetworkStateListener: () => ({ remove() {} })
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const error = yield* Effect.flip(network.current)
      expect(error).toBeInstanceOf(NetworkContractViolation)
      expect(error.operation).toBe("current")
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("removes the native listener when the stream scope closes", () => {
    let listener: ((state: unknown) => void) | undefined
    let removals = 0
    let markRegistered!: () => void
    const registered = new Promise<void>((resolve) => {
      markRegistered = resolve
    })
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => offline,
      addNetworkStateListener: (next) => {
        listener = next
        markRegistered()
        return {
          remove() {
            removals += 1
          }
        }
      }
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const fiber = yield* network.changes.pipe(Stream.take(1), Stream.runDrain, Effect.forkChild)
      yield* Effect.promise(() => registered)
      listener?.(wifi)
      yield* Fiber.join(fiber)
      expect(removals).toBe(1)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("classifies listener registration failures", () => {
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => offline,
      addNetworkStateListener: () => {
        throw new Error("listener registration failed")
      }
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const error = yield* network.changes.pipe(Stream.runDrain, Effect.flip)
      expect(error).toBeInstanceOf(NetworkNativeError)
      expect(error.operation).toBe("changes")
      expect(error.message).toBe("listener registration failed")
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("classifies an unavailable native listener", () => {
    const cause = { code: "ERR_UNAVAILABLE" }
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => offline,
      addNetworkStateListener: () => {
        throw cause
      }
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const error = yield* network.changes.pipe(Stream.runDrain, Effect.flip)
      expect(error).toBeInstanceOf(NetworkUnavailable)
      if (!(error instanceof NetworkUnavailable)) return
      expect(error.operation).toBe("changes")
      expect(error.nativeCode).toBe("ERR_UNAVAILABLE")
      expect("cause" in error).toBe(false)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("removes the listener when a native event violates the contract", () => {
    let listener: ((state: unknown) => void) | undefined
    let removals = 0
    let markRegistered!: () => void
    const registered = new Promise<void>((resolve) => {
      markRegistered = resolve
    })
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => offline,
      addNetworkStateListener: (next) => {
        listener = next
        markRegistered()
        return {
          remove() {
            removals += 1
          }
        }
      }
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const fiber = yield* network.changes.pipe(Stream.runDrain, Effect.forkChild)
      yield* Effect.promise(() => registered)
      listener?.({ ...wifi, isConnected: "yes" })
      const error = yield* Fiber.join(fiber).pipe(Effect.flip)
      expect(error).toBeInstanceOf(NetworkContractViolation)
      expect(error.operation).toBe("changes")
      expect(removals).toBe(1)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("removes the listener when a waiting stream is interrupted", () => {
    let removals = 0
    let markRegistered!: () => void
    const registered = new Promise<void>((resolve) => {
      markRegistered = resolve
    })
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => offline,
      addNetworkStateListener: () => {
        markRegistered()
        return {
          remove() {
            removals += 1
          }
        }
      }
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const fiber = yield* network.changes.pipe(Stream.runDrain, Effect.forkChild)
      yield* Effect.promise(() => registered)
      yield* Fiber.interrupt(fiber)
      expect(removals).toBe(1)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("keeps listener finalization non-defecting when native remove throws", () => {
    let listener: ((state: unknown) => void) | undefined
    let markRegistered!: () => void
    const registered = new Promise<void>((resolve) => {
      markRegistered = resolve
    })
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => offline,
      addNetworkStateListener: (next) => {
        listener = next
        markRegistered()
        return {
          remove() {
            throw new Error("raw cleanup detail")
          }
        }
      }
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const fiber = yield* network.changes.pipe(
        Stream.take(1),
        Stream.runDrain,
        Effect.forkChild({ startImmediately: true })
      )
      yield* Effect.promise(() => registered)
      listener?.(wifi)
      yield* Fiber.join(fiber)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("tolerates additive native state fields while returning the public contract", () => {
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => ({ ...wifi, transportName: "wifi" }),
      addNetworkStateListener: () => ({ remove() {} })
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const state = yield* network.current
      expect(state).toEqual(wifi)
      expect("transportName" in state).toBe(false)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("turns hostile native getters into a typed contract violation", () => {
    const nativeState = {
      get type(): never {
        throw new Error("hostile getter")
      },
      isConnected: true,
      isInternetReachable: true
    }
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => nativeState,
      addNetworkStateListener: () => ({ remove() {} })
    }

    return Effect.gen(function* () {
      const network = yield* Network
      const error = yield* Effect.flip(network.current)
      expect(error).toBeInstanceOf(NetworkContractViolation)
      expect(error.operation).toBe("current")
      if (!(error instanceof NetworkContractViolation)) return
      expect(error.issue).toBe("Native network state could not be read")
      expect("parseError" in error).toBe(false)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect("does not read unrelated additive native getters", () => {
    const nativeState = {
      ...wifi,
      get secret(): never {
        throw new Error("must not be read")
      }
    }
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => nativeState,
      addNetworkStateListener: () => ({ remove() {} })
    }

    return Effect.gen(function* () {
      const network = yield* Network
      expect(yield* network.current).toEqual(wifi)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect.prop(
    "accepts every Schema-generated native NetworkState",
    [NetworkState],
    ([state]) => {
      const native: NativeNetwork = {
        getNetworkStateAsync: async () => state,
        addNetworkStateListener: () => ({ remove() {} })
      }

      return Effect.gen(function* () {
        const network = yield* Network
        const decoded = yield* network.current
        expect(decoded).toEqual(state)
      }).pipe(Effect.provide(layerFromNative(native)))
    }
  )

  it.effect.prop(
    "rejects every Schema-generated string in a native boolean field",
    [Schema.String],
    ([invalidConnectivity]) => {
      const native: NativeNetwork = {
        getNetworkStateAsync: async () => ({
          ...offline,
          isConnected: invalidConnectivity
        }),
        addNetworkStateListener: () => ({ remove() {} })
      }

      return Effect.gen(function* () {
        const network = yield* Network
        const error = yield* Effect.flip(network.current)
        expect(error).toBeInstanceOf(NetworkContractViolation)
        expect(error.operation).toBe("current")
      }).pipe(Effect.provide(layerFromNative(native)))
    }
  )

  it.effect.prop(
    "accepts independent reachability for every non-NONE transport",
    [Schema.Literals(["UNKNOWN", "CELLULAR", "WIFI", "ETHERNET", "OTHER"])],
    ([type]) =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknownEffect(NetworkState)({
          type,
          isConnected: false,
          isInternetReachable: true
        })
        expect(result).toEqual({ type, isConnected: false, isInternetReachable: true })
      })
  )

  it.effect("accepts Expo Android UNKNOWN with a validated but unmapped transport", () => {
    const state = {
      type: "UNKNOWN",
      isConnected: false,
      isInternetReachable: true
    } as const
    const native: NativeNetwork = {
      getNetworkStateAsync: async () => state,
      addNetworkStateListener: () => ({ remove() {} })
    }

    return Effect.gen(function* () {
      const network = yield* Network
      expect(yield* network.current).toEqual(state)
    }).pipe(Effect.provide(layerFromNative(native)))
  })

  it.effect.prop("rejects connected NONE states", [Schema.Boolean], ([isInternetReachable]) =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NetworkState)({
        type: "NONE",
        isConnected: true,
        isInternetReachable
      }).pipe(Effect.exit)
      expect(result._tag).toBe("Failure")
    })
  )

  it.effect("preserves Expo's UNKNOWN but connected web and iOS state", () =>
    Schema.decodeUnknownEffect(NetworkState)({
      type: "UNKNOWN",
      isConnected: true,
      isInternetReachable: true
    }).pipe(
      Effect.tap((state) => Effect.sync(() => expect(state.type).toBe("UNKNOWN"))),
      Effect.asVoid
    )
  )
})
