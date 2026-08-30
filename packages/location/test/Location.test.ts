import { beforeEach, describe, expect, it, vi } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import type {
  Location as LocationService,
  LocationFailure,
  LocationUnavailable,
} from "../src/Location.ts"

/* oxlint-disable effecttsgo/strict-effect-provide -- test runtime boundary */

const location = {
  coords: {
    latitude: 48.2,
    longitude: 16.37,
    altitude: 180,
    accuracy: 5,
    altitudeAccuracy: 3,
    heading: 90,
    speed: 1,
  },
  timestamp: 1,
}

const permission = {
  status: "granted",
  granted: true,
  canAskAgain: true,
  expires: "never",
}

const mocks = vi.hoisted(() => ({
  getProviderStatusAsync: vi.fn(),
  enableNetworkProviderAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(),
  watchPositionAsync: vi.fn(),
  getHeadingAsync: vi.fn(),
  watchHeadingAsync: vi.fn(),
  geocodeAsync: vi.fn(),
  reverseGeocodeAsync: vi.fn(),
  getForegroundPermissionsAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  getBackgroundPermissionsAsync: vi.fn(),
  requestBackgroundPermissionsAsync: vi.fn(),
  hasServicesEnabledAsync: vi.fn(),
  getMotionActivityPermissionsAsync: vi.fn(),
  requestMotionActivityPermissionsAsync: vi.fn(),
  getMotionActivityAsync: vi.fn(),
  watchMotionActivityAsync: vi.fn(),
  isBackgroundLocationAvailableAsync: vi.fn(),
  startLocationUpdatesAsync: vi.fn(),
  stopLocationUpdatesAsync: vi.fn(),
  hasStartedLocationUpdatesAsync: vi.fn(),
  startGeofencingAsync: vi.fn(),
  stopGeofencingAsync: vi.fn(),
  hasStartedGeofencingAsync: vi.fn(),
}))

vi.mock("expo-location", () => ({
  ...mocks,
  Accuracy: { Balanced: 3 },
  ActivityType: { Other: 1 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  GeofencingRegionState: { Unknown: 0, Inside: 1, Outside: 2 },
  LocationAccuracy: { Balanced: 3 },
  LocationActivityType: { Other: 1 },
  LocationGeofencingEventType: { Enter: 1, Exit: 2 },
  LocationGeofencingRegionState: { Unknown: 0, Inside: 1, Outside: 2 },
  MotionActivityConfidence: { Low: 0, Medium: 1, High: 2 },
  MotionActivityType: { Walking: "walking", Unknown: "unknown" },
  PermissionStatus: { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" },
}))

const Location = await import("../src/Location.ts")

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Location.live)) as Effect.Effect<A, E>)

describe("@better-native/location", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getProviderStatusAsync.mockResolvedValue({
      locationServicesEnabled: true,
      backgroundModeEnabled: true,
    })
    mocks.enableNetworkProviderAsync.mockResolvedValue(undefined)
    mocks.getCurrentPositionAsync.mockResolvedValue(location)
    mocks.watchPositionAsync.mockImplementation(async (_options, emit) => {
      emit(location)
      return { remove: vi.fn() }
    })
    mocks.getLastKnownPositionAsync.mockResolvedValue(location)
    mocks.getHeadingAsync.mockResolvedValue({ trueHeading: 10, magHeading: 11, accuracy: 3 })
    mocks.watchHeadingAsync.mockImplementation(async (emit) => {
      emit({ trueHeading: 10, magHeading: 11, accuracy: 3 })
      return { remove: vi.fn() }
    })
    mocks.geocodeAsync.mockResolvedValue([{ latitude: 48.2, longitude: 16.37 }])
    mocks.reverseGeocodeAsync.mockResolvedValue([{ city: "Vienna" }])
    mocks.getForegroundPermissionsAsync.mockResolvedValue(permission)
    mocks.requestForegroundPermissionsAsync.mockResolvedValue(permission)
    mocks.getBackgroundPermissionsAsync.mockResolvedValue(permission)
    mocks.requestBackgroundPermissionsAsync.mockResolvedValue(permission)
    mocks.hasServicesEnabledAsync.mockResolvedValue(true)
    mocks.getMotionActivityPermissionsAsync.mockResolvedValue(permission)
    mocks.requestMotionActivityPermissionsAsync.mockResolvedValue(permission)
    mocks.getMotionActivityAsync.mockResolvedValue({ activities: {}, timestamp: 1 })
    mocks.watchMotionActivityAsync.mockImplementation(async (emit) => {
      emit({ activities: {}, timestamp: 1 })
      return { remove: vi.fn() }
    })
    mocks.isBackgroundLocationAvailableAsync.mockResolvedValue(true)
    mocks.startLocationUpdatesAsync.mockResolvedValue(undefined)
    mocks.stopLocationUpdatesAsync.mockResolvedValue(undefined)
    mocks.hasStartedLocationUpdatesAsync.mockResolvedValue(true)
    mocks.startGeofencingAsync.mockResolvedValue(undefined)
    mocks.stopGeofencingAsync.mockResolvedValue(undefined)
    mocks.hasStartedGeofencingAsync.mockResolvedValue(true)
  })

  it("wraps one-shot reads, permissions, geocoding, and persistent registrations", async () => {
    await expect(run(Location.getProviderStatusAsync)).resolves.toMatchObject({
      backgroundModeEnabled: true,
    })
    await expect(run(Location.enableNetworkProviderAsync)).resolves.toBeUndefined()
    await expect(
      run(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })),
    ).resolves.toEqual(location)
    await expect(run(Location.getLastKnownPositionAsync({ maxAge: 1000 }))).resolves.toEqual(
      location,
    )
    await expect(run(Location.getHeadingAsync)).resolves.toMatchObject({ accuracy: 3 })
    await expect(run(Location.geocodeAsync("Vienna"))).resolves.toHaveLength(1)
    await expect(
      run(Location.reverseGeocodeAsync({ latitude: 48.2, longitude: 16.37 })),
    ).resolves.toHaveLength(1)
    await expect(run(Location.getForegroundPermissionsAsync)).resolves.toEqual(permission)
    await expect(run(Location.requestForegroundPermissionsAsync)).resolves.toEqual(permission)
    await expect(run(Location.getBackgroundPermissionsAsync)).resolves.toEqual(permission)
    await expect(run(Location.requestBackgroundPermissionsAsync)).resolves.toEqual(permission)
    await expect(run(Location.hasServicesEnabledAsync)).resolves.toBe(true)
    await expect(run(Location.getMotionActivityPermissionsAsync)).resolves.toEqual(permission)
    await expect(run(Location.requestMotionActivityPermissionsAsync)).resolves.toEqual(permission)
    await expect(run(Location.getMotionActivityAsync)).resolves.toMatchObject({ timestamp: 1 })
    await expect(run(Location.isBackgroundLocationAvailableAsync)).resolves.toBe(true)
    await expect(
      run(Location.startLocationUpdatesAsync("track", { accuracy: Location.Accuracy.Balanced })),
    ).resolves.toBeUndefined()
    await expect(run(Location.stopLocationUpdatesAsync("track"))).resolves.toBeUndefined()
    await expect(run(Location.hasStartedLocationUpdatesAsync("track"))).resolves.toBe(true)
    const region = { latitude: 48.2, longitude: 16.37, radius: 100 }
    await expect(run(Location.startGeofencingAsync("fence", [region]))).resolves.toBeUndefined()
    await expect(run(Location.startGeofencingAsync("default"))).rejects.toBeInstanceOf(
      Location.LocationFailure,
    )
    await expect(run(Location.stopGeofencingAsync("fence"))).resolves.toBeUndefined()
    await expect(run(Location.hasStartedGeofencingAsync("fence"))).resolves.toBe(true)
    expect(mocks.startGeofencingAsync).toHaveBeenNthCalledWith(1, "fence", [region])
    expect(mocks.startGeofencingAsync).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["position", () => Location.watchPositionAsync({}), mocks.watchPositionAsync, location],
    [
      "heading",
      () => Location.watchHeadingAsync(),
      mocks.watchHeadingAsync,
      { trueHeading: 1, magHeading: 2, accuracy: 3 },
    ],
    [
      "motion",
      () => Location.watchMotionActivityAsync(),
      mocks.watchMotionActivityAsync,
      { activities: {}, timestamp: 1 },
    ],
  ] as const)(
    "streams %s updates with scoped native cleanup",
    async (_, stream, subscribe, value) => {
      const remove = vi.fn()
      subscribe.mockImplementationOnce(async (...args: ReadonlyArray<unknown>) => {
        const emit = args.find(
          (argument): argument is (item: unknown) => void => typeof argument === "function",
        )!
        emit(value)
        return { remove }
      })
      await expect(
        Effect.runPromise(
          (
            stream() as Stream.Stream<
              unknown,
              LocationFailure | LocationUnavailable,
              LocationService
            >
          ).pipe(Stream.take(1), Stream.runCollect, Effect.provide(Location.live)),
        ),
      ).resolves.toEqual(expect.objectContaining({ 0: value }))
      expect(remove).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    ["position", mocks.watchPositionAsync, () => Location.watchPositionAsync({})],
    ["heading", mocks.watchHeadingAsync, () => Location.watchHeadingAsync()],
    ["motion", mocks.watchMotionActivityAsync, () => Location.watchMotionActivityAsync()],
  ] as const)(
    "turns %s watcher callback errors into typed stream failures",
    async (_, subscribe, stream) => {
      const remove = vi.fn()
      subscribe.mockImplementationOnce(async (...args: ReadonlyArray<unknown>) => {
        const fail = args.at(-1) as (reason: string) => void
        fail("permission denied")
        return { remove }
      })
      const current = stream() as Stream.Stream<
        unknown,
        LocationFailure | LocationUnavailable,
        LocationService
      >
      const exit = await Effect.runPromiseExit(
        current.pipe(Stream.runDrain, Effect.provide(Location.live)),
      )
      expect(exit._tag).toBe("Failure")
      expect(remove).toHaveBeenCalledTimes(1)
    },
  )

  it("releases an interrupted heading one-shot watcher", async () => {
    const remove = vi.fn()
    mocks.watchHeadingAsync.mockImplementationOnce(async () => ({ remove }))
    const fiber = Effect.runFork(Location.getHeadingAsync.pipe(Effect.provide(Location.live)))
    await vi.waitFor(() => expect(mocks.watchHeadingAsync).toHaveBeenCalledTimes(1))
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("releases an interrupted motion one-shot watcher", async () => {
    const remove = vi.fn()
    mocks.watchMotionActivityAsync.mockImplementationOnce(async () => ({ remove }))
    const fiber = Effect.runFork(
      Location.getMotionActivityAsync.pipe(Effect.provide(Location.live)),
    )
    await vi.waitFor(() => expect(mocks.watchMotionActivityAsync).toHaveBeenCalledTimes(1))
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("classifies unavailable and ordinary native failures", async () => {
    mocks.watchPositionAsync.mockRejectedValueOnce(
      Object.assign(new Error("unavailable"), { code: "ERR_UNAVAILABLE" }),
    )
    const unavailable = await Effect.runPromiseExit(
      Location.getCurrentPositionAsync().pipe(Effect.provide(Location.live)),
    )
    expect(unavailable._tag).toBe("Failure")
    if (unavailable._tag === "Failure") {
      const reason = unavailable.cause.reasons[0]
      expect(reason !== undefined && Cause.isFailReason(reason) && reason.error).toBeInstanceOf(
        Location.LocationUnavailable,
      )
    }

    mocks.geocodeAsync.mockRejectedValueOnce(new Error("geocoder failed"))
    const failed = await Effect.runPromiseExit(
      Location.geocodeAsync("Vienna").pipe(Effect.provide(Location.live)),
    )
    expect(failed._tag).toBe("Failure")
    if (failed._tag === "Failure") {
      const reason = failed.cause.reasons[0]
      expect(reason !== undefined && Cause.isFailReason(reason) && reason.error).toBeInstanceOf(
        Location.LocationFailure,
      )
    }
  })

  it("exports permission atoms and runtime enum aliases", () => {
    expect(Location.foregroundPermissionAtom).toBeDefined()
    expect(Location.backgroundPermissionAtom).toBeDefined()
    expect(Location.motionActivityPermissionAtom).toBeDefined()
    expect(Location.LocationAccuracy).toEqual(Location.Accuracy)
    expect(Location.LocationActivityType).toEqual(Location.ActivityType)
    expect(Location.LocationGeofencingEventType).toEqual(Location.GeofencingEventType)
    expect(Location.LocationGeofencingRegionState).toEqual(Location.GeofencingRegionState)
  })

  it("hydrates all permission atoms from the live Effect service", async () => {
    const registry = AtomRegistry.make()
    const atoms = [
      Location.foregroundPermissionAtom,
      Location.backgroundPermissionAtom,
      Location.motionActivityPermissionAtom,
    ] as const
    const releases = atoms.map((atom) => registry.mount(atom))
    try {
      await vi.waitFor(() => {
        for (const atom of atoms) {
          const result = registry.get(atom)
          expect(AsyncResult.isSuccess(result)).toBe(true)
          if (AsyncResult.isSuccess(result)) expect(result.value).toEqual(permission)
        }
      })
      expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1)
      expect(mocks.getBackgroundPermissionsAsync).toHaveBeenCalledTimes(1)
      expect(mocks.getMotionActivityPermissionsAsync).toHaveBeenCalledTimes(1)
    } finally {
      for (const release of releases) release()
    }
  })

  it("rejects malformed native payloads in the typed failure channel", async () => {
    mocks.getProviderStatusAsync.mockResolvedValueOnce({ locationServicesEnabled: "yes" })
    const exit = await Effect.runPromiseExit(
      Location.getProviderStatusAsync.pipe(Effect.provide(Location.live)),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason !== undefined && Cause.isFailReason(reason) && reason.error).toBeInstanceOf(
        Location.LocationFailure,
      )
    }
  })

  it("rejects null one-shot and streamed native payloads without defects", async () => {
    mocks.getProviderStatusAsync.mockResolvedValueOnce(null)
    mocks.watchHeadingAsync.mockImplementationOnce(async (emit) => {
      emit(null)
      return { remove: vi.fn() }
    })
    mocks.watchMotionActivityAsync.mockImplementationOnce(async (emit) => {
      emit(null)
      return { remove: vi.fn() }
    })
    for (const effect of [
      Location.getProviderStatusAsync,
      Location.getHeadingAsync,
      Location.getMotionActivityAsync,
    ] as ReadonlyArray<
      Effect.Effect<unknown, LocationFailure | LocationUnavailable, LocationService>
    >) {
      const exit = await Effect.runPromiseExit(effect.pipe(Effect.provide(Location.live)))
      expect(exit._tag).toBe("Failure")
    }

    const remove = vi.fn()
    mocks.watchHeadingAsync.mockImplementationOnce(async (emit) => {
      emit(null)
      return { remove }
    })
    const streamExit = await Effect.runPromiseExit(
      Location.watchHeadingAsync().pipe(Stream.runDrain, Effect.provide(Location.live)),
    )
    expect(streamExit._tag).toBe("Failure")
    expect(remove).toHaveBeenCalledTimes(1)
  })
})
