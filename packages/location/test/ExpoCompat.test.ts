// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

const plugin = vi.fn()
const expo = vi.hoisted(() => ({
  Accuracy: {},
  ActivityType: {},
  EventEmitter: {},
  GeofencingEventType: {},
  GeofencingRegionState: {},
  LocationAccuracy: {},
  LocationActivityType: {},
  LocationGeofencingEventType: {},
  LocationGeofencingRegionState: {},
  MotionActivityConfidence: {},
  MotionActivityType: {},
  PermissionStatus: {},
  _getCurrentWatchId: vi.fn(),
  enableNetworkProviderAsync: vi.fn(),
  geocodeAsync: vi.fn(),
  getBackgroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  getForegroundPermissionsAsync: vi.fn(),
  getHeadingAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(),
  getMotionActivityAsync: vi.fn(),
  getMotionActivityPermissionsAsync: vi.fn(),
  getProviderStatusAsync: vi.fn(),
  hasServicesEnabledAsync: vi.fn(),
  hasStartedGeofencingAsync: vi.fn(),
  hasStartedLocationUpdatesAsync: vi.fn(),
  installWebGeolocationPolyfill: vi.fn(),
  isBackgroundLocationAvailableAsync: vi.fn(),
  requestBackgroundPermissionsAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  requestMotionActivityPermissionsAsync: vi.fn(),
  reverseGeocodeAsync: vi.fn(),
  startGeofencingAsync: vi.fn(),
  startLocationUpdatesAsync: vi.fn(),
  stopGeofencingAsync: vi.fn(),
  stopLocationUpdatesAsync: vi.fn(),
  useBackgroundPermissions: vi.fn(),
  useForegroundPermissions: vi.fn(),
  useMotionActivityPermissions: vi.fn(),
  watchHeadingAsync: vi.fn(),
  watchMotionActivityAsync: vi.fn(),
  watchPositionAsync: vi.fn(),
}))

vi.mock("expo-location", () => expo)
vi.mock("expo-location/app.plugin.js", () => ({ default: plugin }))

const ExpoCompat = await import("../src/Expo.ts")
const Plugin = await import("../src/Plugin.ts")

describe("@better-native/location compatibility entrypoints", () => {
  it("re-exports every generated Expo Location runtime value by identity", () => {
    expect(Object.keys(ExpoCompat).sort()).toEqual(Object.keys(expo).sort())
    for (const name of Object.keys(expo) as Array<keyof typeof expo>) {
      expect(ExpoCompat[name]).toBe(expo[name])
    }
  })

  it("preserves the config-plugin default export", () => {
    expect(Plugin.default).toBe(plugin)
  })

  it("preserves all three Expo permission-hook lifecycles", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    const permission = { status: "granted", granted: true, canAskAgain: true, expires: "never" }
    const request = vi.fn(async () => permission)
    const get = vi.fn(async () => permission)
    expo.useForegroundPermissions.mockReturnValue([permission, request, get])
    expo.useBackgroundPermissions.mockReturnValue([permission, request, get])
    expo.useMotionActivityPermissions.mockReturnValue([permission, request, get])
    const snapshots: Array<unknown> = []
    const Probe = () => {
      snapshots.push(
        ExpoCompat.useForegroundPermissions(),
        ExpoCompat.useBackgroundPermissions(),
        ExpoCompat.useMotionActivityPermissions(),
      )
      return null
    }
    const root = createRoot(document.createElement("div"))
    await act(async () => root.render(React.createElement(Probe)))
    expect(snapshots).toEqual([
      [permission, request, get],
      [permission, request, get],
      [permission, request, get],
    ])
    await act(async () => root.unmount())
  })
})
