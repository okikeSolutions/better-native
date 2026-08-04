import { describe, expect, it, vi } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

vi.mock("expo-battery", () => ({
  BatteryState: {
    UNKNOWN: 0,
    UNPLUGGED: 1,
    CHARGING: 2,
    FULL: 3,
    NOT_CHARGING: 4,
  },
  isAvailableAsync: vi.fn(),
  getBatteryLevelAsync: vi.fn(),
  getBatteryStateAsync: vi.fn(),
  isLowPowerModeEnabledAsync: vi.fn(),
  isBatteryOptimizationEnabledAsync: vi.fn(),
  getPowerStateAsync: vi.fn(),
  addBatteryLevelListener: vi.fn(),
  addBatteryStateListener: vi.fn(),
  addLowPowerModeListener: vi.fn(),
  useBatteryLevel: vi.fn(),
  useBatteryState: vi.fn(),
  useLowPowerMode: vi.fn(),
  usePowerState: vi.fn(),
}))

const ExpoBattery = await import("expo-battery")
const { Battery, BatteryFailure, BatteryService, BatteryState } = await import("../src/index")

describe("@better-native/battery", () => {
  it("reads power state through an Effect service", async () => {
    const TestBattery = Layer.succeed(
      BatteryService,
      BatteryService.of({
        isAvailable: Effect.succeed(true),
        getLevel: Effect.succeed(0.82),
        getState: Effect.succeed(BatteryState.CHARGING),
        isLowPowerModeEnabled: Effect.succeed(false),
        isBatteryOptimizationEnabled: Effect.succeed(false),
        getPowerState: Effect.succeed({
          batteryLevel: 0.82,
          batteryState: BatteryState.CHARGING,
          lowPowerMode: false,
        }),
        levelChanges: Stream.fromArray([{ batteryLevel: 0.82 }]),
        stateChanges: Stream.fromArray([{ batteryState: BatteryState.CHARGING }]),
        lowPowerModeChanges: Stream.fromArray([{ lowPowerMode: false }]),
      }),
    )

    const result = await Effect.runPromise(Battery.getPowerState.pipe(Effect.provide(TestBattery)))

    expect(result).toEqual({
      batteryLevel: 0.82,
      batteryState: BatteryState.CHARGING,
      lowPowerMode: false,
    })
  })

  it("exports Effect atoms for React integrations", () => {
    expect(Battery.levelAtom).toBeDefined()
    expect(Battery.stateAtom).toBeDefined()
    expect(Battery.lowPowerModeAtom).toBeDefined()
    expect(Battery.powerStateAtom).toBeDefined()
  })

  it("reads availability through an Effect service", async () => {
    const TestBattery = Layer.succeed(
      BatteryService,
      BatteryService.of({
        isAvailable: Effect.succeed(true),
        getLevel: Effect.succeed(1),
        getState: Effect.succeed(BatteryState.FULL),
        isLowPowerModeEnabled: Effect.succeed(false),
        isBatteryOptimizationEnabled: Effect.succeed(false),
        getPowerState: Effect.succeed({
          batteryLevel: 1,
          batteryState: BatteryState.FULL,
          lowPowerMode: false,
        }),
        levelChanges: Stream.empty,
        stateChanges: Stream.empty,
        lowPowerModeChanges: Stream.empty,
      }),
    )

    await expect(
      Effect.runPromise(Battery.isAvailable.pipe(Effect.provide(TestBattery))),
    ).resolves.toBe(true)
  })

  it("reads battery-optimization state through the live Expo service", async () => {
    vi.mocked(ExpoBattery.isBatteryOptimizationEnabledAsync).mockResolvedValueOnce(true)

    await expect(
      Effect.runPromise(Battery.isBatteryOptimizationEnabled.pipe(Effect.provide(Battery.live))),
    ).resolves.toBe(true)
  })

  it("rejects malformed Expo power-state payloads", async () => {
    vi.mocked(ExpoBattery.getPowerStateAsync).mockResolvedValueOnce({
      batteryLevel: "not a number",
      batteryState: BatteryState.CHARGING,
      lowPowerMode: false,
    } as never)

    const exit = await Effect.runPromiseExit(
      Battery.getPowerState.pipe(Effect.provide(Battery.live)),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason).toBeDefined()
      if (
        reason !== undefined &&
        Cause.isFailReason(reason) &&
        reason.error instanceof BatteryFailure
      ) {
        expect(reason.error.method).toBe("getPowerStateAsync")
      } else {
        throw new Error("expected a BatteryFailure")
      }
    }
  })

  it("streams battery level changes through an Effect service", async () => {
    const TestBattery = Layer.succeed(
      BatteryService,
      BatteryService.of({
        isAvailable: Effect.succeed(true),
        getLevel: Effect.succeed(0.82),
        getState: Effect.succeed(BatteryState.CHARGING),
        isLowPowerModeEnabled: Effect.succeed(false),
        isBatteryOptimizationEnabled: Effect.succeed(false),
        getPowerState: Effect.succeed({
          batteryLevel: 0.82,
          batteryState: BatteryState.CHARGING,
          lowPowerMode: false,
        }),
        levelChanges: Stream.fromArray([{ batteryLevel: 0.82 }]),
        stateChanges: Stream.fromArray([{ batteryState: BatteryState.CHARGING }]),
        lowPowerModeChanges: Stream.fromArray([{ lowPowerMode: false }]),
      }),
    )

    const result = await Effect.runPromise(
      Battery.levelChanges.pipe(Stream.take(1), Stream.runCollect, Effect.provide(TestBattery)),
    )

    expect(Array.from(result)).toEqual([{ batteryLevel: 0.82 }])
  })

  it("wraps Expo battery listeners as scoped streams", async () => {
    const remove = vi.fn()
    vi.mocked(ExpoBattery.addBatteryLevelListener).mockImplementation((listener) => {
      listener({ batteryLevel: 0.82 })
      return { remove }
    })

    const result = await Effect.runPromise(
      Battery.levelChanges.pipe(Stream.take(1), Stream.runCollect, Effect.provide(Battery.live)),
    )

    expect(Array.from(result)).toEqual([{ batteryLevel: 0.82 }])
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      "battery level",
      "addBatteryLevelListener",
      () => {
        vi.mocked(ExpoBattery.addBatteryLevelListener).mockImplementationOnce(() => {
          throw new Error("addBatteryLevelListener failed")
        })
        return Battery.levelChanges.pipe(
          Stream.take(1),
          Stream.runDrain,
          Effect.provide(Battery.live),
        )
      },
    ],
    [
      "battery state",
      "addBatteryStateListener",
      () => {
        vi.mocked(ExpoBattery.addBatteryStateListener).mockImplementationOnce(() => {
          throw new Error("addBatteryStateListener failed")
        })
        return Battery.stateChanges.pipe(
          Stream.take(1),
          Stream.runDrain,
          Effect.provide(Battery.live),
        )
      },
    ],
    [
      "low-power mode",
      "addLowPowerModeListener",
      () => {
        vi.mocked(ExpoBattery.addLowPowerModeListener).mockImplementationOnce(() => {
          throw new Error("addLowPowerModeListener failed")
        })
        return Battery.lowPowerModeChanges.pipe(
          Stream.take(1),
          Stream.runDrain,
          Effect.provide(Battery.live),
        )
      },
    ],
  ] as const)("fails when the %s listener cannot be registered", async (_, method, run) => {
    const exit = await Effect.runPromiseExit(run())

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason).toBeDefined()
      if (
        reason !== undefined &&
        Cause.isFailReason(reason) &&
        reason.error instanceof BatteryFailure
      ) {
        expect(reason.error.method).toBe(method)
      } else {
        throw new Error("expected a BatteryFailure")
      }
    }
  })

  it("updates live atoms from native events and releases their subscriptions", async () => {
    let level = 0.82
    let state = BatteryState.CHARGING
    let lowPowerMode = false
    const levelListeners: Array<(event: { readonly batteryLevel: number }) => void> = []
    const stateListeners: Array<(event: { readonly batteryState: typeof state }) => void> = []
    const lowPowerModeListeners: Array<(event: { readonly lowPowerMode: boolean }) => void> = []
    const removeLevel = vi.fn()
    const removeState = vi.fn()
    const removeLowPowerMode = vi.fn()
    vi.mocked(ExpoBattery.getBatteryLevelAsync).mockImplementation(() => Promise.resolve(level))
    vi.mocked(ExpoBattery.getBatteryStateAsync).mockImplementation(() => Promise.resolve(state))
    vi.mocked(ExpoBattery.isLowPowerModeEnabledAsync).mockImplementation(() =>
      Promise.resolve(lowPowerMode),
    )
    vi.mocked(ExpoBattery.getPowerStateAsync).mockImplementation(() =>
      Promise.resolve({ batteryLevel: level, batteryState: state, lowPowerMode }),
    )
    vi.mocked(ExpoBattery.addBatteryLevelListener).mockImplementation((listener) => {
      levelListeners.push(listener)
      return { remove: removeLevel }
    })
    vi.mocked(ExpoBattery.addBatteryStateListener).mockImplementation((listener) => {
      stateListeners.push(listener)
      return { remove: removeState }
    })
    vi.mocked(ExpoBattery.addLowPowerModeListener).mockImplementation((listener) => {
      lowPowerModeListeners.push(listener)
      return { remove: removeLowPowerMode }
    })
    const registry = AtomRegistry.make()
    const cancel = [
      registry.mount(Battery.levelAtom),
      registry.mount(Battery.stateAtom),
      registry.mount(Battery.lowPowerModeAtom),
      registry.mount(Battery.powerStateAtom),
    ]
    const value = <A>(atom: Parameters<typeof registry.get>[0]) => {
      const result = registry.get(atom) as AsyncResult.AsyncResult<A, never>
      expect(AsyncResult.isSuccess(result)).toBe(true)
      return (result as AsyncResult.Success<A, never>).value
    }

    expect(value<number>(Battery.levelAtom)).toBe(-1)
    expect(value<typeof BatteryState.CHARGING>(Battery.stateAtom)).toBe(BatteryState.UNKNOWN)
    expect(value<boolean>(Battery.lowPowerModeAtom)).toBe(false)
    await vi.waitFor(() => {
      expect(value<number>(Battery.levelAtom)).toBe(0.82)
      expect(value<typeof BatteryState.CHARGING>(Battery.stateAtom)).toBe(BatteryState.CHARGING)
      expect(value<boolean>(Battery.lowPowerModeAtom)).toBe(false)
      expect(value(Battery.powerStateAtom)).toEqual({
        batteryLevel: 0.82,
        batteryState: BatteryState.CHARGING,
        lowPowerMode: false,
      })
      expect(levelListeners).toHaveLength(2)
      expect(stateListeners).toHaveLength(2)
      expect(lowPowerModeListeners).toHaveLength(2)
    })

    level = 0.37
    state = BatteryState.FULL
    lowPowerMode = true
    for (const listener of levelListeners) listener({ batteryLevel: level })
    for (const listener of stateListeners) listener({ batteryState: state })
    for (const listener of lowPowerModeListeners) listener({ lowPowerMode })
    await vi.waitFor(() => {
      expect(value<number>(Battery.levelAtom)).toBe(0.37)
      expect(value<typeof BatteryState.FULL>(Battery.stateAtom)).toBe(BatteryState.FULL)
      expect(value<boolean>(Battery.lowPowerModeAtom)).toBe(true)
      expect(value(Battery.powerStateAtom)).toEqual({
        batteryLevel: 0.37,
        batteryState: BatteryState.FULL,
        lowPowerMode: true,
      })
    })

    for (const release of cancel) release()
    await vi.waitFor(() => {
      expect(removeLevel).toHaveBeenCalledTimes(2)
      expect(removeState).toHaveBeenCalledTimes(2)
      expect(removeLowPowerMode).toHaveBeenCalledTimes(2)
    })
  })
})
