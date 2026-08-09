// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

/* oxlint-disable effecttsgo/strict-effect-provide -- test runtime boundary */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"

vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  ActivityType: {},
  GeofencingEventType: {},
  GeofencingRegionState: {},
  LocationAccuracy: { Balanced: 3 },
  LocationActivityType: {},
  LocationGeofencingEventType: {},
  LocationGeofencingRegionState: {},
  MotionActivityConfidence: {},
  MotionActivityType: {},
  PermissionStatus: {},
  getProviderStatusAsync: vi.fn(async () => ({ locationServicesEnabled: true })),
  getLastKnownPositionAsync: vi.fn(async () => null),
  getHeadingAsync: vi.fn(),
  geocodeAsync: vi.fn(async () => []),
  reverseGeocodeAsync: vi.fn(async () => []),
  getForegroundPermissionsAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  getBackgroundPermissionsAsync: vi.fn(),
  requestBackgroundPermissionsAsync: vi.fn(),
  hasServicesEnabledAsync: vi.fn(async () => true),
  getMotionActivityPermissionsAsync: vi.fn(),
  requestMotionActivityPermissionsAsync: vi.fn(),
  getMotionActivityAsync: vi.fn(),
  isBackgroundLocationAvailableAsync: vi.fn(async () => undefined),
  enableNetworkProviderAsync: vi.fn(),
  startLocationUpdatesAsync: vi.fn(),
  stopLocationUpdatesAsync: vi.fn(),
  hasStartedLocationUpdatesAsync: vi.fn(),
  startGeofencingAsync: vi.fn(),
  stopGeofencingAsync: vi.fn(),
  hasStartedGeofencingAsync: vi.fn(),
  watchPositionAsync: vi.fn(),
  watchHeadingAsync: vi.fn(),
  watchMotionActivityAsync: vi.fn(),
}))

const Location = await import("../src/Location.ts")

describe("Location web adapter", () => {
  const clearWatch = vi.fn()
  let fail: PositionErrorCallback | undefined

  beforeEach(() => {
    clearWatch.mockClear()
    fail = undefined
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition: vi.fn((_success: PositionCallback, onError: PositionErrorCallback) => {
          fail = onError
          return 41
        }),
        clearWatch,
      },
    })
  })

  it("routes browser position errors through LocationFailure and clears the watch", async () => {
    const running = Effect.runPromiseExit(
      Location.watchPositionAsync().pipe(Stream.runDrain, Effect.provide(Location.live)),
    )
    await vi.waitFor(() => expect(fail).toBeDefined())
    fail?.({
      code: 1,
      message: "denied",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    })
    const exit = await running
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason !== undefined && Cause.isFailReason(reason) && reason.error).toBeInstanceOf(
        Location.LocationFailure,
      )
    }
    expect(clearWatch).toHaveBeenCalledWith(41)
  })

  it("interrupts a pending current-position watch and runs native cleanup", async () => {
    const fiber = Effect.runFork(
      Location.getCurrentPositionAsync().pipe(Effect.provide(Location.live)),
    )
    await vi.waitFor(() => expect(fail).toBeDefined())
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(clearWatch).toHaveBeenCalledWith(41)
  })

  it("fails unsupported heading, motion stream, and motion read immediately", async () => {
    const exits = await Promise.all([
      Effect.runPromiseExit(
        Location.watchHeadingAsync().pipe(Stream.runDrain, Effect.provide(Location.live)),
      ),
      Effect.runPromiseExit(
        Location.watchMotionActivityAsync().pipe(Stream.runDrain, Effect.provide(Location.live)),
      ),
      Effect.runPromiseExit(Location.getMotionActivityAsync.pipe(Effect.provide(Location.live))),
    ])
    expect(exits.every((exit) => exit._tag === "Failure")).toBe(true)
  })

  it("normalizes Expo's missing web background-mode field to false", async () => {
    await expect(
      Effect.runPromise(
        Location.isBackgroundLocationAvailableAsync.pipe(Effect.provide(Location.live)),
      ),
    ).resolves.toBe(false)
  })

  it("fails with LocationUnavailable when browser geolocation is absent", async () => {
    Reflect.deleteProperty(navigator, "geolocation")
    const exit = await Effect.runPromiseExit(
      Location.watchPositionAsync().pipe(Stream.runDrain, Effect.provide(Location.live)),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason !== undefined && Cause.isFailReason(reason) && reason.error).toBeInstanceOf(
        Location.LocationUnavailable,
      )
    }
  })
})
