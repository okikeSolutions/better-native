// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

const battery = vi.hoisted(() => {
  let level = -1
  let state = 0
  let lowPowerMode = false
  let pendingReads: Array<() => void> = []
  const levelListeners = new Set<(event: { readonly batteryLevel: number }) => void>()
  const stateListeners = new Set<(event: { readonly batteryState: number }) => void>()
  const lowPowerModeListeners = new Set<(event: { readonly lowPowerMode: boolean }) => void>()
  return {
    get level() {
      return level
    },
    set level(value: number) {
      level = value
    },
    get state() {
      return state
    },
    set state(value: number) {
      state = value
    },
    get lowPowerMode() {
      return lowPowerMode
    },
    set lowPowerMode(value: boolean) {
      lowPowerMode = value
    },
    read: <A>(value: () => A) =>
      new Promise<A>((resolve) => {
        pendingReads.push(() => resolve(value()))
      }),
    resolveReads: () => {
      const reads = pendingReads
      pendingReads = []
      for (const resolve of reads) resolve()
    },
    onLevel: (listener: (event: { readonly batteryLevel: number }) => void) => {
      levelListeners.add(listener)
      return { remove: () => void levelListeners.delete(listener) }
    },
    onState: (listener: (event: { readonly batteryState: number }) => void) => {
      stateListeners.add(listener)
      return { remove: () => void stateListeners.delete(listener) }
    },
    onLowPowerMode: (listener: (event: { readonly lowPowerMode: boolean }) => void) => {
      lowPowerModeListeners.add(listener)
      return { remove: () => void lowPowerModeListeners.delete(listener) }
    },
    emitLevel: (value: number) => {
      level = value
      for (const listener of levelListeners) listener({ batteryLevel: value })
    },
    emitState: (value: number) => {
      state = value
      for (const listener of stateListeners) listener({ batteryState: value })
    },
    emitLowPowerMode: (value: boolean) => {
      lowPowerMode = value
      for (const listener of lowPowerModeListeners) listener({ lowPowerMode: value })
    },
    listenerCounts: () => ({
      level: levelListeners.size,
      state: stateListeners.size,
      lowPowerMode: lowPowerModeListeners.size,
    }),
    reset: () => {
      level = -1
      state = 0
      lowPowerMode = false
      pendingReads = []
      levelListeners.clear()
      stateListeners.clear()
      lowPowerModeListeners.clear()
    },
  }
})

vi.mock("expo-battery", async () => {
  const React = await import("react")
  const getBatteryLevelAsync = () => battery.read(() => battery.level)
  const getBatteryStateAsync = () => battery.read(() => battery.state)
  const isLowPowerModeEnabledAsync = () => battery.read(() => battery.lowPowerMode)
  const addBatteryLevelListener = battery.onLevel
  const addBatteryStateListener = battery.onState
  const addLowPowerModeListener = battery.onLowPowerMode
  return {
    BatteryState: { UNKNOWN: 0, FULL: 3 },
    isAvailableAsync: () => Promise.resolve(true),
    getBatteryLevelAsync,
    getBatteryStateAsync,
    isLowPowerModeEnabledAsync,
    isBatteryOptimizationEnabledAsync: () => Promise.resolve(false),
    getPowerStateAsync: () =>
      Promise.all([
        getBatteryLevelAsync(),
        getBatteryStateAsync(),
        isLowPowerModeEnabledAsync(),
      ]).then(([batteryLevel, batteryState, lowPowerMode]) => ({
        batteryLevel,
        batteryState,
        lowPowerMode,
      })),
    addBatteryLevelListener,
    addBatteryStateListener,
    addLowPowerModeListener,
    useBatteryLevel: () => {
      const [value, setValue] = React.useState(-1)
      React.useEffect(() => {
        void getBatteryLevelAsync().then(setValue)
        return addBatteryLevelListener(({ batteryLevel }) => setValue(batteryLevel)).remove
      }, [])
      return value
    },
    useBatteryState: () => {
      const [value, setValue] = React.useState(0)
      React.useEffect(() => {
        void getBatteryStateAsync().then(setValue)
        return addBatteryStateListener(({ batteryState }) => setValue(batteryState)).remove
      }, [])
      return value
    },
    useLowPowerMode: () => {
      const [value, setValue] = React.useState(false)
      React.useEffect(() => {
        void isLowPowerModeEnabledAsync().then(setValue)
        return addLowPowerModeListener(({ lowPowerMode }) => setValue(lowPowerMode)).remove
      }, [])
      return value
    },
    usePowerState: () => {
      const [batteryLevel, setBatteryLevel] = React.useState(-1)
      const [batteryState, setBatteryState] = React.useState(0)
      const [lowPowerMode, setLowPowerMode] = React.useState(false)
      React.useEffect(() => {
        void getBatteryLevelAsync().then(setBatteryLevel)
        void getBatteryStateAsync().then(setBatteryState)
        void isLowPowerModeEnabledAsync().then(setLowPowerMode)
        const level = addBatteryLevelListener(({ batteryLevel }) => setBatteryLevel(batteryLevel))
        const state = addBatteryStateListener(({ batteryState }) => setBatteryState(batteryState))
        const lowPowerMode = addLowPowerModeListener(({ lowPowerMode }) =>
          setLowPowerMode(lowPowerMode),
        )
        return () => {
          level.remove()
          state.remove()
          lowPowerMode.remove()
        }
      }, [])
      return { batteryLevel, batteryState, lowPowerMode }
    },
  }
})

const ExpoCompat = await import("../src/Expo")
const ExpoBattery = await import("expo-battery")
const { Battery: EffectBattery } = await import("../src/index")

afterEach(() => {
  battery.reset()
  vi.unstubAllGlobals()
})

describe("@better-native/battery/expo", () => {
  it("exports the Expo-compatible battery surface without wrapping hooks", () => {
    expect(typeof ExpoCompat.BatteryState).toBe("object")
    expect(typeof ExpoCompat.isAvailableAsync).toBe("function")
    expect(typeof ExpoCompat.getBatteryLevelAsync).toBe("function")
    expect(typeof ExpoCompat.getBatteryStateAsync).toBe("function")
    expect(typeof ExpoCompat.isLowPowerModeEnabledAsync).toBe("function")
    expect(typeof ExpoCompat.isBatteryOptimizationEnabledAsync).toBe("function")
    expect(typeof ExpoCompat.getPowerStateAsync).toBe("function")
    expect(typeof ExpoCompat.addBatteryLevelListener).toBe("function")
    expect(typeof ExpoCompat.addBatteryStateListener).toBe("function")
    expect(typeof ExpoCompat.addLowPowerModeListener).toBe("function")
    expect(ExpoCompat.useBatteryLevel).toBe(ExpoBattery.useBatteryLevel)
    expect(ExpoCompat.useBatteryState).toBe(ExpoBattery.useBatteryState)
    expect(ExpoCompat.useLowPowerMode).toBe(ExpoBattery.useLowPowerMode)
    expect(ExpoCompat.usePowerState).toBe(ExpoBattery.usePowerState)
  })

  it("reads initial values and applies native battery updates", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    const container = document.createElement("div")
    const root = createRoot(container)
    let snapshot:
      | {
          readonly level: number
          readonly state: number
          readonly lowPowerMode: boolean
          readonly power: {
            readonly batteryLevel: number
            readonly batteryState: number
            readonly lowPowerMode: boolean
          }
        }
      | undefined
    const Probe = () => {
      snapshot = {
        level: ExpoCompat.useBatteryLevel(),
        state: ExpoCompat.useBatteryState(),
        lowPowerMode: ExpoCompat.useLowPowerMode(),
        power: ExpoCompat.usePowerState(),
      }
      return null
    }

    await act(async () => {
      root.render(React.createElement(Probe))
    })
    expect(snapshot).toEqual({
      level: -1,
      state: 0,
      lowPowerMode: false,
      power: { batteryLevel: -1, batteryState: 0, lowPowerMode: false },
    })

    battery.level = 0.82
    battery.state = ExpoCompat.BatteryState.FULL
    battery.lowPowerMode = true

    await act(async () => {
      battery.resolveReads()
    })
    expect(snapshot).toEqual({
      level: 0.82,
      state: ExpoCompat.BatteryState.FULL,
      lowPowerMode: true,
      power: { batteryLevel: 0.82, batteryState: ExpoCompat.BatteryState.FULL, lowPowerMode: true },
    })

    await act(async () => {
      battery.emitLevel(0.12)
      battery.emitState(ExpoCompat.BatteryState.FULL)
      battery.emitLowPowerMode(true)
      battery.emitLevel(0.37)
      battery.emitState(ExpoCompat.BatteryState.UNKNOWN)
      battery.emitLowPowerMode(false)
    })
    expect(snapshot).toEqual({
      level: 0.37,
      state: ExpoCompat.BatteryState.UNKNOWN,
      lowPowerMode: false,
      power: {
        batteryLevel: 0.37,
        batteryState: ExpoCompat.BatteryState.UNKNOWN,
        lowPowerMode: false,
      },
    })

    await act(async () => {
      root.unmount()
    })
  })

  it("matches the live battery atoms across initial reads and listener updates", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    const root = createRoot(document.createElement("div"))
    const registry = AtomRegistry.make()
    const releases = [
      registry.mount(EffectBattery.levelAtom),
      registry.mount(EffectBattery.stateAtom),
      registry.mount(EffectBattery.lowPowerModeAtom),
      registry.mount(EffectBattery.powerStateAtom),
    ]
    const value = <A>(atom: Parameters<typeof registry.get>[0]) => {
      const result = registry.get(atom) as AsyncResult.AsyncResult<A, never>
      if (!AsyncResult.isSuccess(result)) throw new Error("expected atom value")
      return result.value
    }
    let snapshot:
      | {
          readonly level: number
          readonly state: number
          readonly lowPowerMode: boolean
          readonly power: {
            readonly batteryLevel: number
            readonly batteryState: number
            readonly lowPowerMode: boolean
          }
        }
      | undefined
    const Probe = () => {
      snapshot = {
        level: ExpoCompat.useBatteryLevel(),
        state: ExpoCompat.useBatteryState(),
        lowPowerMode: ExpoCompat.useLowPowerMode(),
        power: ExpoCompat.usePowerState(),
      }
      return null
    }

    await act(async () => {
      root.render(React.createElement(Probe))
    })
    expect(snapshot).toEqual({
      level: value<number>(EffectBattery.levelAtom),
      state: value<number>(EffectBattery.stateAtom),
      lowPowerMode: value<boolean>(EffectBattery.lowPowerModeAtom),
      power: value(EffectBattery.powerStateAtom),
    })
    await vi.waitFor(() =>
      expect(battery.listenerCounts()).toEqual({ level: 4, state: 4, lowPowerMode: 4 }),
    )

    await act(async () => {
      battery.emitLevel(0.82)
      battery.emitState(ExpoCompat.BatteryState.FULL)
      battery.emitLowPowerMode(true)
    })
    await vi.waitFor(() => {
      expect(snapshot).toEqual({
        level: value<number>(EffectBattery.levelAtom),
        state: value<number>(EffectBattery.stateAtom),
        lowPowerMode: value<boolean>(EffectBattery.lowPowerModeAtom),
        power: value(EffectBattery.powerStateAtom),
      })
    })

    await act(async () => {
      battery.resolveReads()
    })
    await vi.waitFor(() => {
      expect(snapshot).toEqual({
        level: value<number>(EffectBattery.levelAtom),
        state: value<number>(EffectBattery.stateAtom),
        lowPowerMode: value<boolean>(EffectBattery.lowPowerModeAtom),
        power: value(EffectBattery.powerStateAtom),
      })
    })

    await act(async () => {
      battery.emitLevel(0.12)
      battery.emitState(ExpoCompat.BatteryState.FULL)
      battery.emitLowPowerMode(true)
      battery.emitLevel(0.37)
      battery.emitState(ExpoCompat.BatteryState.UNKNOWN)
      battery.emitLowPowerMode(false)
    })
    await vi.waitFor(() => {
      expect(snapshot).toEqual({
        level: value<number>(EffectBattery.levelAtom),
        state: value<number>(EffectBattery.stateAtom),
        lowPowerMode: value<boolean>(EffectBattery.lowPowerModeAtom),
        power: value(EffectBattery.powerStateAtom),
      })
    })

    await act(async () => {
      root.unmount()
    })
    for (const release of releases) release()
    await vi.waitFor(() =>
      expect(battery.listenerCounts()).toEqual({ level: 0, state: 0, lowPowerMode: 0 }),
    )
  })

  it("removes every listener on unmount and ignores adversarial post-unmount events", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    const root = createRoot(document.createElement("div"))
    const Probe = () => {
      ExpoCompat.useBatteryLevel()
      ExpoCompat.useBatteryState()
      ExpoCompat.useLowPowerMode()
      ExpoCompat.usePowerState()
      return null
    }

    await act(async () => {
      root.render(React.createElement(Probe))
    })
    expect(battery.listenerCounts()).toEqual({ level: 2, state: 2, lowPowerMode: 2 })

    await act(async () => {
      root.unmount()
    })
    expect(battery.listenerCounts()).toEqual({ level: 0, state: 0, lowPowerMode: 0 })

    await act(async () => {
      battery.emitLevel(0.12)
      battery.emitState(ExpoCompat.BatteryState.FULL)
      battery.emitLowPowerMode(true)
    })
    expect(battery.listenerCounts()).toEqual({ level: 0, state: 0, lowPowerMode: 0 })
  })
})
