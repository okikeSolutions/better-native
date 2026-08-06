import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as ExpoBattery from "expo-battery"

/**
 * Runtime battery-state enum re-exported for schemas and comparisons.
 *
 * @category models
 * @since 0.0.0
 */
export const BatteryState = ExpoBattery.BatteryState

/**
 * Battery-state enum value type.
 *
 * @category models
 * @since 0.0.0
 */
export type BatteryState = ExpoBattery.BatteryState

/**
 * Schema for a snapshot containing battery level, battery state, and low-power mode.
 *
 * @category models
 * @since 0.0.0
 */
export const PowerState = Schema.Struct({
  batteryLevel: Schema.Number,
  batteryState: Schema.Enum(BatteryState),
  lowPowerMode: Schema.Boolean,
})

/**
 * Power-state snapshot returned by {@link getPowerState}.
 *
 * @category models
 * @since 0.0.0
 */
export type PowerState = ExpoBattery.PowerState

/**
 * Event emitted when the battery level changes.
 *
 * @category models
 * @since 0.0.0
 */
export type BatteryLevelEvent = ExpoBattery.BatteryLevelEvent

/**
 * Event emitted when the battery state changes.
 *
 * @category models
 * @since 0.0.0
 */
export type BatteryStateEvent = ExpoBattery.BatteryStateEvent

/**
 * Event emitted when low-power mode changes.
 *
 * @category models
 * @since 0.0.0
 */
export type PowerModeEvent = ExpoBattery.PowerModeEvent

/**
 * Native event subscription returned by Expo listener APIs.
 *
 * @category models
 * @since 0.0.0
 */
export type Subscription = ExpoBattery.Subscription

/**
 * Tagged error for failed battery native operations.
 *
 * @category errors
 * @since 0.0.0
 */
export class BatteryFailure extends Data.TaggedError("BatteryFailure")<{
  readonly method: string
  readonly cause: unknown
}> {}

/**
 * Battery service contract used by the Effect-native API.
 *
 * @category services
 * @since 0.0.0
 */
export interface Service {
  readonly isAvailable: Effect.Effect<boolean, BatteryFailure>
  readonly getLevel: Effect.Effect<number, BatteryFailure>
  readonly getState: Effect.Effect<BatteryState, BatteryFailure>
  readonly isLowPowerModeEnabled: Effect.Effect<boolean, BatteryFailure>
  readonly isBatteryOptimizationEnabled: Effect.Effect<boolean, BatteryFailure>
  readonly getPowerState: Effect.Effect<PowerState, BatteryFailure>
  readonly levelChanges: Stream.Stream<BatteryLevelEvent, BatteryFailure>
  readonly stateChanges: Stream.Stream<BatteryStateEvent, BatteryFailure>
  readonly lowPowerModeChanges: Stream.Stream<PowerModeEvent, BatteryFailure>
}

/**
 * Context tag for accessing the battery service from an Effect.
 *
 * @category services
 * @since 0.0.0
 */
export class Battery extends Context.Service<Battery, Service>()(
  "@better-native/battery/Battery",
) {}

const failure = (method: string, cause: unknown) => new BatteryFailure({ method, cause })

const method = <A>(name: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => failure(name, cause) })

const decodePowerState = (value: unknown) =>
  Schema.decodeUnknownEffect(PowerState)(value).pipe(
    Effect.mapError((cause) => failure("getPowerStateAsync", cause)),
  )

const getPowerStateFromExpoParts = method(
  "getPowerStateAsync",
  ExpoBattery.getPowerStateAsync,
).pipe(Effect.flatMap(decodePowerState))

/**
 * Checks whether battery APIs are available on the current device.
 *
 * Fails with {@link BatteryFailure} if the native availability check rejects.
 *
 * @category readings
 * @since 0.0.0
 */
export const isAvailable = Effect.flatMap(Battery, (battery) => battery.isAvailable)

/**
 * Reads the current battery level as a number from `0` to `1`.
 *
 * Fails with {@link BatteryFailure} if the native level read rejects.
 *
 * @category readings
 * @since 0.0.0
 */
export const getLevel = Effect.flatMap(Battery, (battery) => battery.getLevel)

/**
 * Reads the current battery state.
 *
 * Fails with {@link BatteryFailure} if the native state read rejects.
 *
 * @category readings
 * @since 0.0.0
 */
export const getState = Effect.flatMap(Battery, (battery) => battery.getState)

/**
 * Checks whether low-power mode is currently enabled.
 *
 * Fails with {@link BatteryFailure} if the native low-power-mode read rejects.
 *
 * @category readings
 * @since 0.0.0
 */
export const isLowPowerModeEnabled = Effect.flatMap(
  Battery,
  (battery) => battery.isLowPowerModeEnabled,
)

/**
 * Checks whether Android battery optimization is enabled for the application.
 *
 * Fails with {@link BatteryFailure} if the native optimization read rejects.
 *
 * @category readings
 * @since 0.0.0
 */
export const isBatteryOptimizationEnabled = Effect.flatMap(
  Battery,
  (battery) => battery.isBatteryOptimizationEnabled,
)

/**
 * Reads a combined power-state snapshot.
 *
 * The live implementation composes the native level, state, and low-power-mode reads and validates
 * the combined object with {@link PowerState}.
 *
 * @category readings
 * @since 0.0.0
 */
export const getPowerState = Effect.flatMap(Battery, (battery) => battery.getPowerState)

/**
 * Streams battery-level change events.
 *
 * The native subscription is removed when the stream scope closes.
 *
 * @category streams
 * @since 0.0.0
 */
export const levelChanges = Stream.unwrap(Effect.map(Battery, (battery) => battery.levelChanges))

/**
 * Streams battery-state change events.
 *
 * The native subscription is removed when the stream scope closes.
 *
 * @category streams
 * @since 0.0.0
 */
export const stateChanges = Stream.unwrap(Effect.map(Battery, (battery) => battery.stateChanges))

/**
 * Streams low-power-mode change events.
 *
 * The native subscription is removed when the stream scope closes.
 *
 * @category streams
 * @since 0.0.0
 */
export const lowPowerModeChanges = Stream.unwrap(
  Effect.map(Battery, (battery) => battery.lowPowerModeChanges),
)

const makeLevelChanges = Stream.callback<BatteryLevelEvent, BatteryFailure>((queue) =>
  Effect.acquireRelease(
    Effect.try({
      try: () =>
        ExpoBattery.addBatteryLevelListener((event) => {
          Queue.offerUnsafe(queue, event)
        }),
      catch: (cause) => failure("addBatteryLevelListener", cause),
    }).pipe(Effect.tapError((cause) => Queue.fail(queue, cause))),
    (subscription) => Effect.sync(() => subscription.remove()),
  ),
)

const makeStateChanges = Stream.callback<BatteryStateEvent, BatteryFailure>((queue) =>
  Effect.acquireRelease(
    Effect.try({
      try: () =>
        ExpoBattery.addBatteryStateListener((event) => {
          Queue.offerUnsafe(queue, event)
        }),
      catch: (cause) => failure("addBatteryStateListener", cause),
    }).pipe(Effect.tapError((cause) => Queue.fail(queue, cause))),
    (subscription) => Effect.sync(() => subscription.remove()),
  ),
)

const makeLowPowerModeChanges = Stream.callback<PowerModeEvent, BatteryFailure>((queue) =>
  Effect.acquireRelease(
    Effect.try({
      try: () =>
        ExpoBattery.addLowPowerModeListener((event) => {
          Queue.offerUnsafe(queue, event)
        }),
      catch: (cause) => failure("addLowPowerModeListener", cause),
    }).pipe(Effect.tapError((cause) => Queue.fail(queue, cause))),
    (subscription) => Effect.sync(() => subscription.remove()),
  ),
)

/**
 * Live battery layer backed by Expo Battery.
 *
 * @category layers
 * @since 0.0.0
 */
export const live = Layer.succeed(
  Battery,
  Battery.of({
    isAvailable: method("isAvailableAsync", ExpoBattery.isAvailableAsync),
    getLevel: method("getBatteryLevelAsync", ExpoBattery.getBatteryLevelAsync),
    getState: method("getBatteryStateAsync", ExpoBattery.getBatteryStateAsync),
    isLowPowerModeEnabled: method(
      "isLowPowerModeEnabledAsync",
      ExpoBattery.isLowPowerModeEnabledAsync,
    ),
    isBatteryOptimizationEnabled: method(
      "isBatteryOptimizationEnabledAsync",
      ExpoBattery.isBatteryOptimizationEnabledAsync,
    ),
    getPowerState: getPowerStateFromExpoParts,
    levelChanges: makeLevelChanges,
    stateChanges: makeStateChanges,
    lowPowerModeChanges: makeLowPowerModeChanges,
  }),
)

/**
 * Atom containing the initial battery level and subsequent native level changes.
 *
 * React applications can consume this atom with `@effect/atom-react`. The atom exposes Effect's
 * async result state instead of hiding failures in a React-only hook.
 *
 * @category atoms
 * @since 0.0.0
 */
export const levelAtom = Atom.make(
  Stream.merge(
    Stream.fromEffect(getLevel),
    Stream.map(levelChanges, (event) => event.batteryLevel),
  ).pipe(Stream.provide(live)),
  { initialValue: -1 },
)

/**
 * Atom containing the initial battery state and subsequent native state changes.
 *
 * React applications can consume this atom with `@effect/atom-react`. The atom exposes Effect's
 * async result state instead of hiding failures in a React-only hook.
 *
 * @category atoms
 * @since 0.0.0
 */
export const stateAtom = Atom.make(
  Stream.merge(
    Stream.fromEffect(getState),
    Stream.map(stateChanges, (event) => event.batteryState),
  ).pipe(Stream.provide(live)),
  { initialValue: BatteryState.UNKNOWN },
)

/**
 * Atom containing the initial low-power mode and subsequent native mode changes.
 *
 * React applications can consume this atom with `@effect/atom-react`. The atom exposes Effect's
 * async result state instead of hiding failures in a React-only hook.
 *
 * @category atoms
 * @since 0.0.0
 */
export const lowPowerModeAtom = Atom.make(
  Stream.merge(
    Stream.fromEffect(isLowPowerModeEnabled),
    Stream.map(lowPowerModeChanges, (event) => event.lowPowerMode),
  ).pipe(Stream.provide(live)),
  { initialValue: false },
)

/**
 * Atom containing the initial power-state snapshot and subsequent native changes.
 *
 * React applications can consume this atom with `@effect/atom-react`. The atom exposes Effect's
 * async result state instead of hiding failures in a React-only hook.
 *
 * @category atoms
 * @since 0.0.0
 */
const initialPowerState: PowerState = {
  batteryLevel: -1,
  batteryState: BatteryState.UNKNOWN,
  lowPowerMode: false,
}

const powerStateChanges = Stream.merge(
  Stream.merge(
    Stream.merge(
      Stream.map(Stream.fromEffect(getPowerState), (value) => ({
        _tag: "snapshot" as const,
        value,
      })),
      Stream.map(levelChanges, (event) => ({ _tag: "level" as const, value: event.batteryLevel })),
    ),
    Stream.map(stateChanges, (event) => ({ _tag: "state" as const, value: event.batteryState })),
  ),
  Stream.map(lowPowerModeChanges, (event) => ({
    _tag: "lowPowerMode" as const,
    value: event.lowPowerMode,
  })),
).pipe(
  Stream.scan(initialPowerState, (current, update) => {
    return Match.value(update).pipe(
      Match.when({ _tag: "snapshot" }, ({ value }) => value),
      Match.when({ _tag: "level" }, ({ value }) => ({ ...current, batteryLevel: value })),
      Match.when({ _tag: "state" }, ({ value }) => ({ ...current, batteryState: value })),
      Match.when({ _tag: "lowPowerMode" }, ({ value }) => ({ ...current, lowPowerMode: value })),
      Match.exhaustive,
    )
  }),
)

export const powerStateAtom = Atom.make(powerStateChanges.pipe(Stream.provide(live)), {
  initialValue: initialPowerState,
})
