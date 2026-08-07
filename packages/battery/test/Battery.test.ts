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

const provideLayer =
  <ROut, E2, RIn>(layer: Layer.Layer<ROut, E2, RIn>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | E2, RIn | Exclude<R, ROut>> =>
    Effect.scoped(
      Layer.build(layer).pipe(Effect.flatMap((context) => Effect.provide(effect, context))),
    )

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

    const result = await Effect.runPromise(
      Battery.getPowerStateAsync.pipe(provideLayer(TestBattery)),
    )

    expect(result).toEqual({
      batteryLevel: 0.82,
      batteryState: BatteryState.CHARGING,
      lowPowerMode: false,
    })
  })

  it("exports Effect atoms for React integrations", () => {
    expect(Battery.batteryLevelAtom).toBeDefined()
    expect(Battery.batteryStateAtom).toBeDefined()
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
      Effect.runPromise(Battery.isAvailableAsync.pipe(provideLayer(TestBattery))),
    ).resolves.toBe(true)
  })

  it("reads battery-optimization state through the live Expo service", async () => {
    vi.mocked(ExpoBattery.isBatteryOptimizationEnabledAsync).mockResolvedValueOnce(true)

    await expect(
      Effect.runPromise(Battery.isBatteryOptimizationEnabledAsync.pipe(provideLayer(Battery.live))),
    ).resolves.toBe(true)
  })

  it("rejects malformed Expo power-state payloads", async () => {
    const powerState = {
      batteryLevel: 0.5,
      batteryState: BatteryState.CHARGING,
      lowPowerMode: false,
    }
    vi.mocked(ExpoBattery.getPowerStateAsync).mockResolvedValueOnce(
      new Proxy(powerState, {
        get: (target, property, receiver) =>
          property === "batteryLevel" ? "not a number" : Reflect.get(target, property, receiver),
      }),
    )

    const exit = await Effect.runPromiseExit(
      Battery.getPowerStateAsync.pipe(provideLayer(Battery.live)),
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
      Battery.addBatteryLevelListener.pipe(
        Stream.take(1),
        Stream.runCollect,
        provideLayer(TestBattery),
      ),
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
      Battery.addBatteryLevelListener.pipe(
        Stream.take(1),
        Stream.runCollect,
        provideLayer(Battery.live),
      ),
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
        return Battery.addBatteryLevelListener.pipe(
          Stream.take(1),
          Stream.runDrain,
          provideLayer(Battery.live),
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
        return Battery.addBatteryStateListener.pipe(
          Stream.take(1),
          Stream.runDrain,
          provideLayer(Battery.live),
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
        return Battery.addLowPowerModeListener.pipe(
          Stream.take(1),
          Stream.runDrain,
          provideLayer(Battery.live),
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
      registry.mount(Battery.batteryLevelAtom),
      registry.mount(Battery.batteryStateAtom),
      registry.mount(Battery.lowPowerModeAtom),
      registry.mount(Battery.powerStateAtom),
    ]
    const values = {
      level: () => AsyncResult.getOrThrow(registry.get(Battery.batteryLevelAtom)),
      state: () => AsyncResult.getOrThrow(registry.get(Battery.batteryStateAtom)),
      lowPowerMode: () => AsyncResult.getOrThrow(registry.get(Battery.lowPowerModeAtom)),
      powerState: () => AsyncResult.getOrThrow(registry.get(Battery.powerStateAtom)),
    }

    expect(values.level()).toBe(-1)
    expect(values.state()).toBe(BatteryState.UNKNOWN)
    expect(values.lowPowerMode()).toBe(false)
    await vi.waitFor(() => {
      expect(values.level()).toBe(0.82)
      expect(values.state()).toBe(BatteryState.CHARGING)
      expect(values.lowPowerMode()).toBe(false)
      expect(values.powerState()).toEqual({
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
      expect(values.level()).toBe(0.37)
      expect(values.state()).toBe(BatteryState.FULL)
      expect(values.lowPowerMode()).toBe(true)
      expect(values.powerState()).toEqual({
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
