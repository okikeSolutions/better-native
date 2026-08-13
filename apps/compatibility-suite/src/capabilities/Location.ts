import { Location } from "@better-native/location"
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as ExpoLocation from "expo-location"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

export const name = "Location Effect capability"

interface JasmineApi {
  readonly describe: (name: string, spec: () => void) => void
  readonly it: (name: string, spec: () => Promise<void>) => void
}

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)]),
  )
}

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- compatibility capability entry point
  Effect.runPromise(effect.pipe(Effect.provide(Location.live)) as Effect.Effect<A, E>)

export function test({ describe, it }: JasmineApi): void {
  describe(name, () => {
    it("reads provider and service state through the live layer", async () => {
      const [
        provider,
        servicesEnabled,
        backgroundAvailable,
        rawProvider,
        rawServices,
        rawBackground,
      ] = await Promise.all([
        run(Location.getProviderStatusAsync),
        run(Location.hasServicesEnabledAsync),
        run(Location.isBackgroundLocationAvailableAsync),
        ExpoLocation.getProviderStatusAsync(),
        ExpoLocation.hasServicesEnabledAsync(),
        ExpoLocation.isBackgroundLocationAvailableAsync(),
      ])
      assert(typeof provider.locationServicesEnabled === "boolean", "provider state was invalid")
      assert(typeof servicesEnabled === "boolean", "service availability was invalid")
      assert(typeof backgroundAvailable === "boolean", "background availability was invalid")
      assert(JSON.stringify(provider) === JSON.stringify(rawProvider), "provider state diverged")
      assert(servicesEnabled === rawServices, "service availability diverged")
      assert(backgroundAvailable === Boolean(rawBackground), "background normalization drifted")
    })

    it("reads all permission states without prompting", async () => {
      const permissions = await Promise.all([
        run(Location.getForegroundPermissionsAsync),
        run(Location.getBackgroundPermissionsAsync),
        run(Location.getMotionActivityPermissionsAsync),
      ])
      const rawPermissions = await Promise.all([
        ExpoLocation.getForegroundPermissionsAsync(),
        ExpoLocation.getBackgroundPermissionsAsync(),
        ExpoLocation.getMotionActivityPermissionsAsync(),
      ])
      for (const permission of permissions) {
        assert(typeof permission.granted === "boolean", "permission response was invalid")
        assert(typeof permission.canAskAgain === "boolean", "permission retry state was invalid")
      }
      assert(
        JSON.stringify(canonical(permissions)) === JSON.stringify(canonical(rawPermissions)),
        "permissions diverged",
      )
    })

    it("preserves enum identity and persistent-registration inspection", async () => {
      assert(Location.Accuracy.Balanced === ExpoLocation.Accuracy.Balanced, "accuracy enum drifted")
      const outcomes = await Promise.all([
        run(
          Effect.exit(Location.hasStartedLocationUpdatesAsync("better-native-location-capability")),
        ),
        run(Effect.exit(Location.hasStartedGeofencingAsync("better-native-geofencing-capability"))),
      ])
      for (const outcome of outcomes) {
        if (outcome._tag === "Success") {
          assert(typeof outcome.value === "boolean", "registration state was invalid")
          continue
        }
        const reason = outcome.cause.reasons[0]
        assert(
          reason !== undefined && Cause.isFailReason(reason),
          "registration failure was untyped",
        )
        assert(
          reason.error instanceof Location.LocationUnavailable ||
            reason.error instanceof Location.LocationFailure,
          "registration failure escaped the Location error channel",
        )
      }
    })

    it("hydrates and releases all permission atoms", async () => {
      const registry = AtomRegistry.make()
      const atoms = [
        Location.foregroundPermissionAtom,
        Location.backgroundPermissionAtom,
        Location.motionActivityPermissionAtom,
      ] as const
      const releases = atoms.map((atom) => registry.mount(atom))
      try {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (atoms.every((atom) => AsyncResult.isSuccess(registry.get(atom)))) return
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        throw new Error("Location permission atoms did not hydrate")
      } finally {
        for (const release of releases) release()
      }
    })
  })
}
