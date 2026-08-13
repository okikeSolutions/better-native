// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

const network = vi.hoisted(() => {
  let state = { type: "UNKNOWN", isConnected: false, isInternetReachable: false }
  let pendingReads: Array<() => void> = []
  const listeners = new Set<(value: typeof state) => void>()
  return {
    get state() {
      return state
    },
    set state(value: typeof state) {
      state = value
    },
    read: () =>
      new Promise<typeof state>((resolve) => {
        pendingReads.push(() => resolve(state))
      }),
    resolveRead: () => {
      const reads = pendingReads
      pendingReads = []
      for (const resolve of reads) resolve()
    },
    onState: (listener: (value: typeof state) => void) => {
      listeners.add(listener)
      return { remove: () => void listeners.delete(listener) }
    },
    emit: (value: typeof state) => {
      state = value
      for (const listener of listeners) listener(value)
    },
    listenerCount: () => listeners.size,
    reset: () => {
      state = { type: "UNKNOWN", isConnected: false, isInternetReachable: false }
      pendingReads = []
      listeners.clear()
    },
  }
})

vi.mock("expo-network", async () => {
  const ReactModule = await import("react")
  const getNetworkStateAsync = network.read
  const addNetworkStateListener = network.onState
  return {
    NetworkStateType: { UNKNOWN: "UNKNOWN", WIFI: "WIFI" },
    getNetworkStateAsync,
    getIpAddressAsync: () => Promise.resolve("127.0.0.1"),
    isAirplaneModeEnabledAsync: () => Promise.resolve(false),
    addNetworkStateListener,
    useNetworkState: () => {
      const [state, setState] = ReactModule.useState({})
      ReactModule.useEffect(() => {
        void getNetworkStateAsync().then(setState)
        return addNetworkStateListener(setState).remove
      }, [])
      return state
    },
  }
})

const ExpoCompat = await import("../src/Expo")
const ExpoNetwork = await import("expo-network")
const { Network: EffectNetwork } = await import("../src/index")

afterEach(() => {
  network.reset()
  vi.unstubAllGlobals()
})

describe("@better-native/network/expo", () => {
  it("exports the Expo-compatible network surface without wrapping hooks", () => {
    expect(typeof ExpoCompat.NetworkStateType).toBe("object")
    expect(typeof ExpoCompat.getNetworkStateAsync).toBe("function")
    expect(typeof ExpoCompat.getIpAddressAsync).toBe("function")
    expect(typeof ExpoCompat.isAirplaneModeEnabledAsync).toBe("function")
    expect(typeof ExpoCompat.addNetworkStateListener).toBe("function")
    expect(ExpoCompat.useNetworkState).toBe(ExpoNetwork.useNetworkState)
  })

  it("reads the initial network state and applies listener updates", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    const root = createRoot(document.createElement("div"))
    let snapshot: ReturnType<typeof ExpoCompat.useNetworkState> | undefined
    const Probe = () => {
      snapshot = ExpoCompat.useNetworkState()
      return null
    }

    await act(async () => {
      root.render(React.createElement(Probe))
    })
    expect(snapshot).toEqual({})

    network.state = { type: "WIFI", isConnected: true, isInternetReachable: true }
    await act(async () => {
      network.resolveRead()
    })
    expect(snapshot).toEqual(network.state)

    const offline = { type: "UNKNOWN", isConnected: false, isInternetReachable: false }
    await act(async () => {
      network.emit(offline)
    })
    expect(snapshot).toEqual(offline)

    await act(async () => {
      root.unmount()
    })
  })

  it("matches the live network atom across initial reads and listener updates", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    const root = createRoot(document.createElement("div"))
    const registry = AtomRegistry.make()
    const release = registry.mount(EffectNetwork.networkStateAtom)
    const value = () => {
      const result = registry.get(EffectNetwork.networkStateAtom)
      if (!AsyncResult.isSuccess(result)) throw new Error("expected atom value")
      return result.value
    }
    let snapshot: ReturnType<typeof ExpoCompat.useNetworkState> | undefined
    const Probe = () => {
      snapshot = ExpoCompat.useNetworkState()
      return null
    }

    await act(async () => {
      root.render(React.createElement(Probe))
    })
    expect(AsyncResult.isSuccess(registry.get(EffectNetwork.networkStateAtom))).toBe(false)
    await vi.waitFor(() => expect(network.listenerCount()).toBe(2))

    await act(async () => {
      network.emit({ type: "WIFI", isConnected: true, isInternetReachable: true })
    })
    await vi.waitFor(() => expect(snapshot).toEqual(value()))

    await act(async () => {
      network.resolveRead()
    })
    await vi.waitFor(() => expect(snapshot).toEqual(value()))

    await act(async () => {
      network.emit({ type: "UNKNOWN", isConnected: false, isInternetReachable: false })
      network.emit({ type: "WIFI", isConnected: true, isInternetReachable: true })
    })
    await vi.waitFor(() => expect(snapshot).toEqual(value()))

    await act(async () => {
      root.unmount()
    })
    release()
    await vi.waitFor(() => expect(network.listenerCount()).toBe(0))
  })

  it("removes the listener before adversarial post-unmount network updates", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    const root = createRoot(document.createElement("div"))
    const Probe = () => {
      ExpoCompat.useNetworkState()
      return null
    }

    await act(async () => {
      root.render(React.createElement(Probe))
    })
    expect(network.listenerCount()).toBe(1)

    await act(async () => {
      root.unmount()
    })
    expect(network.listenerCount()).toBe(0)

    await act(async () => {
      network.emit({ type: "WIFI", isConnected: true, isInternetReachable: true })
    })
    expect(network.listenerCount()).toBe(0)
  })
})
