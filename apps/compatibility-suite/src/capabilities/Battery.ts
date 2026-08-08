import { Battery } from "@better-native/battery"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as ExpoBattery from "expo-battery"

export const name = "Battery Effect capability"

interface JasmineApi {
  readonly describe: (name: string, spec: () => void) => void
  readonly it: (name: string, spec: () => Promise<void>) => void
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const run = <A, E>(effect: Effect.Effect<A, E, Battery.Battery>) =>
  // The Jasmine capability module is the application boundary for this independently selected run.
  // oxlint-disable-next-line effecttsgo/strict-effect-provide
  Effect.runPromise(effect.pipe(Effect.provide(Battery.live)))

const validLevel = (level: number): boolean => level === -1 || (level >= 0 && level <= 1)

export function test({ describe, it }: JasmineApi): void {
  describe(name, () => {
    it("reads native battery capabilities through the live layer", async () => {
      const expo = await Promise.all([
        ExpoBattery.isAvailableAsync(),
        ExpoBattery.getBatteryLevelAsync(),
        ExpoBattery.getBatteryStateAsync(),
        ExpoBattery.isLowPowerModeEnabledAsync(),
        ExpoBattery.isBatteryOptimizationEnabledAsync(),
      ])
      const effect = await run(
        Effect.all([
          Battery.isAvailableAsync,
          Battery.getBatteryLevelAsync,
          Battery.getBatteryStateAsync,
          Battery.isLowPowerModeEnabledAsync,
          Battery.isBatteryOptimizationEnabledAsync,
        ]),
      )
      assert(effect[0] === expo[0], "Effect and Expo availability results differ")
      assert(validLevel(effect[1]), `Effect returned an invalid battery level: ${effect[1]}`)
      assert(Math.abs(effect[1] - expo[1]) <= 0.02, "Effect and Expo battery levels differ")
      assert(effect[2] === expo[2], "Effect and Expo battery states differ")
      assert(effect[3] === expo[3], "Effect and Expo low-power-mode results differ")
      assert(effect[4] === expo[4], "Effect and Expo battery-optimization results differ")
    })

    it("reads and validates the combined native power state", async () => {
      const expoState = await ExpoBattery.getPowerStateAsync()
      const effectState = await run(Battery.getPowerStateAsync)
      assert(validLevel(effectState.batteryLevel), "Power state contained an invalid battery level")
      assert(
        Math.abs(effectState.batteryLevel - expoState.batteryLevel) <= 0.02,
        "Effect and Expo power-state levels differ",
      )
      assert(effectState.batteryState === expoState.batteryState, "Power-state values differ")
      assert(effectState.lowPowerMode === expoState.lowPowerMode, "Power-mode values differ")
    })

    it("acquires and releases all native battery streams", async () => {
      await run(
        Effect.gen(function* () {
          const fibers = yield* Effect.all([
            Battery.addBatteryLevelListener.pipe(Stream.runDrain, Effect.forkChild),
            Battery.addBatteryStateListener.pipe(Stream.runDrain, Effect.forkChild),
            Battery.addLowPowerModeListener.pipe(Stream.runDrain, Effect.forkChild),
          ])
          yield* Effect.sleep("100 millis")
          yield* Effect.forEach(fibers, Fiber.interrupt)
        }),
      )
    })

    it("hydrates and releases all live battery atoms", async () => {
      const registry = AtomRegistry.make()
      const updates = { level: 0, state: 0, lowPowerMode: 0, powerState: 0 }
      const releases = [
        registry.subscribe(Battery.batteryLevelAtom, () => {
          updates.level += 1
        }),
        registry.subscribe(Battery.batteryStateAtom, () => {
          updates.state += 1
        }),
        registry.subscribe(Battery.lowPowerModeAtom, () => {
          updates.lowPowerMode += 1
        }),
        registry.subscribe(Battery.powerStateAtom, () => {
          updates.powerState += 1
        }),
      ]
      try {
        const deadline = Date.now() + 3_000
        while (Date.now() < deadline) {
          const level = registry.get(Battery.batteryLevelAtom)
          const state = registry.get(Battery.batteryStateAtom)
          const lowPowerMode = registry.get(Battery.lowPowerModeAtom)
          const powerState = registry.get(Battery.powerStateAtom)
          if (
            AsyncResult.isSuccess(level) &&
            AsyncResult.isSuccess(state) &&
            AsyncResult.isSuccess(lowPowerMode) &&
            AsyncResult.isSuccess(powerState) &&
            Object.values(updates).every((count) => count > 0)
          ) {
            return
          }
          await delay(25)
        }
        throw new Error("Battery atoms did not hydrate from the live layer")
      } finally {
        for (const release of releases) release()
      }
    })
  })
}
