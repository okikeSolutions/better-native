import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as ExpoLocation from "expo-location"
import type { TaskDefinition } from "@better-native/task-manager"

/**
 * Expo location accuracy values.
 *
 * @category models
 * @since 0.0.0
 */
export const LocationAccuracy = ExpoLocation.LocationAccuracy
/**
 * Expo location accuracy value type.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationAccuracy = ExpoLocation.LocationAccuracy
/**
 * Concise Expo-compatible accuracy alias.
 *
 * @category models
 * @since 0.0.0
 */
export const Accuracy = ExpoLocation.Accuracy
/**
 * Concise accuracy alias type.
 *
 * @category models
 * @since 0.0.0
 */
export type Accuracy = ExpoLocation.LocationAccuracy
/**
 * Expo background location activity values.
 *
 * @category models
 * @since 0.0.0
 */
export const LocationActivityType = ExpoLocation.LocationActivityType
/**
 * Expo background location activity value type.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationActivityType = ExpoLocation.LocationActivityType
/**
 * Concise Expo-compatible activity alias.
 *
 * @category models
 * @since 0.0.0
 */
export const ActivityType = ExpoLocation.ActivityType
/**
 * Concise activity alias type.
 *
 * @category models
 * @since 0.0.0
 */
export type ActivityType = ExpoLocation.LocationActivityType
/**
 * Expo geofencing event values.
 *
 * @category models
 * @since 0.0.0
 */
export const LocationGeofencingEventType = ExpoLocation.LocationGeofencingEventType
/**
 * Expo geofencing event value type.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationGeofencingEventType = ExpoLocation.LocationGeofencingEventType
/**
 * Concise Expo-compatible geofencing event alias.
 *
 * @category models
 * @since 0.0.0
 */
export const GeofencingEventType = ExpoLocation.GeofencingEventType
/**
 * Concise geofencing event alias type.
 *
 * @category models
 * @since 0.0.0
 */
export type GeofencingEventType = ExpoLocation.LocationGeofencingEventType
/**
 * Expo geofencing region-state values.
 *
 * @category models
 * @since 0.0.0
 */
export const LocationGeofencingRegionState = ExpoLocation.LocationGeofencingRegionState
/**
 * Expo geofencing region-state value type.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationGeofencingRegionState = ExpoLocation.LocationGeofencingRegionState
/**
 * Concise Expo-compatible geofencing region-state alias.
 *
 * @category models
 * @since 0.0.0
 */
export const GeofencingRegionState = ExpoLocation.GeofencingRegionState
/**
 * Concise geofencing region-state alias type.
 *
 * @category models
 * @since 0.0.0
 */
export type GeofencingRegionState = ExpoLocation.LocationGeofencingRegionState
/**
 * Expo motion-activity confidence values.
 *
 * @category models
 * @since 0.0.0
 */
export const MotionActivityConfidence = ExpoLocation.MotionActivityConfidence
/**
 * Expo motion-activity confidence value type.
 *
 * @category models
 * @since 0.0.0
 */
export type MotionActivityConfidence = ExpoLocation.MotionActivityConfidence
/**
 * Expo motion-activity values.
 *
 * @category models
 * @since 0.0.0
 */
export const MotionActivityType = ExpoLocation.MotionActivityType
/**
 * Expo motion-activity value type.
 *
 * @category models
 * @since 0.0.0
 */
export type MotionActivityType = ExpoLocation.MotionActivityType
/**
 * Expo permission status values.
 *
 * @category models
 * @since 0.0.0
 */
export const PermissionStatus = ExpoLocation.PermissionStatus
/**
 * Expo permission status value type.
 *
 * @category models
 * @since 0.0.0
 */
export type PermissionStatus = ExpoLocation.PermissionStatus

/**
 * Current-position options.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationOptions = ExpoLocation.LocationOptions
/**
 * Last-known-position constraints.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationLastKnownOptions = ExpoLocation.LocationLastKnownOptions
/**
 * Persistent background-location options.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationTaskOptions = ExpoLocation.LocationTaskOptions
/**
 * Android foreground-service options for background location.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationTaskServiceOptions = ExpoLocation.LocationTaskServiceOptions
/**
 * Geofencing region definition.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationRegion = ExpoLocation.LocationRegion
/**
 * Location reading returned by Expo.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationObject = ExpoLocation.LocationObject
/**
 * Coordinate fields contained in a location reading.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationObjectCoords = ExpoLocation.LocationObjectCoords
/**
 * Expo location callback type retained for migration.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationCallback = ExpoLocation.LocationCallback
/**
 * Expo watcher error callback type retained for migration.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationErrorCallback = ExpoLocation.LocationErrorCallback
/**
 * Native location-provider status.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationProviderStatus = ExpoLocation.LocationProviderStatus
/**
 * Compass heading reading.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationHeadingObject = ExpoLocation.LocationHeadingObject
/**
 * Expo heading callback type retained for migration.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationHeadingCallback = ExpoLocation.LocationHeadingCallback
/**
 * Forward-geocoding result.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationGeocodedLocation = ExpoLocation.LocationGeocodedLocation
/**
 * Reverse-geocoding result.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationGeocodedAddress = ExpoLocation.LocationGeocodedAddress
/**
 * Expo subscription shape retained for migration.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationSubscription = ExpoLocation.LocationSubscription
/**
 * iOS-specific location permission details.
 *
 * @category models
 * @since 0.0.0
 */
export type PermissionDetailsLocationIOS = ExpoLocation.PermissionDetailsLocationIOS
/**
 * Android-specific location permission details.
 *
 * @category models
 * @since 0.0.0
 */
export type PermissionDetailsLocationAndroid = ExpoLocation.PermissionDetailsLocationAndroid
/**
 * Foreground location permission response.
 *
 * @category models
 * @since 0.0.0
 */
export type LocationPermissionResponse = ExpoLocation.LocationPermissionResponse
/**
 * General Expo permission response.
 *
 * @category models
 * @since 0.0.0
 */
export type PermissionResponse = ExpoLocation.PermissionResponse
/**
 * Expo permission-hook options retained by the compatibility entrypoint.
 *
 * @category models
 * @since 0.0.0
 */
export type PermissionHookOptions<Options extends object = object> =
  ExpoLocation.PermissionHookOptions<Options>
/**
 * Expo permission expiration value.
 *
 * @category models
 * @since 0.0.0
 */
export type PermissionExpiration = ExpoLocation.PermissionExpiration
/**
 * State for one classified motion activity.
 *
 * @category models
 * @since 0.0.0
 */
export type MotionActivityState = ExpoLocation.MotionActivityState
/**
 * Motion activity snapshot.
 *
 * @category models
 * @since 0.0.0
 */
export type MotionActivityObject = ExpoLocation.MotionActivityObject
/**
 * Expo motion callback type retained for migration.
 *
 * @category models
 * @since 0.0.0
 */
export type MotionActivityCallback = ExpoLocation.MotionActivityCallback

/**
 * Foreground position options plus the bounded sliding Stream buffer size.
 *
 * @category models
 * @since 0.0.0
 */
export interface LocationStreamOptions extends LocationOptions {
  readonly bufferSize?: number
}

/**
 * Buffer configuration shared by heading and motion-activity Streams.
 *
 * @category models
 * @since 0.0.0
 */
export interface SensorStreamOptions {
  readonly bufferSize?: number
}

/**
 * Typed failure for an Expo Location operation unavailable on the current platform.
 *
 * @category errors
 * @since 0.0.0
 */
export class LocationUnavailable extends Data.TaggedError("LocationUnavailable")<{
  readonly method: string
  readonly cause: unknown
}> {}

/**
 * Typed failure for rejected Location operations and watcher errors.
 *
 * @category errors
 * @since 0.0.0
 */
export class LocationFailure extends Data.TaggedError("LocationFailure")<{
  readonly method: string
  readonly cause: unknown
}> {}

type ErrorType = LocationUnavailable | LocationFailure

/**
 * Injectable Location service contract for live and controlled layers.
 *
 * @category services
 * @since 0.0.0
 */
export interface Service {
  readonly providerStatus: Effect.Effect<LocationProviderStatus, ErrorType>
  readonly enableNetworkProvider: Effect.Effect<void, ErrorType>
  readonly currentPosition: (options?: LocationOptions) => Effect.Effect<LocationObject, ErrorType>
  readonly lastKnownPosition: (
    options?: LocationLastKnownOptions,
  ) => Effect.Effect<LocationObject | null, ErrorType>
  readonly positions: (
    options?: LocationOptions,
    bufferSize?: number,
  ) => Stream.Stream<LocationObject, ErrorType>
  readonly heading: Effect.Effect<LocationHeadingObject, ErrorType>
  readonly headings: (bufferSize?: number) => Stream.Stream<LocationHeadingObject, ErrorType>
  readonly geocode: (
    address: string,
  ) => Effect.Effect<ReadonlyArray<LocationGeocodedLocation>, ErrorType>
  readonly reverseGeocode: (
    location: Pick<LocationGeocodedLocation, "latitude" | "longitude">,
  ) => Effect.Effect<ReadonlyArray<LocationGeocodedAddress>, ErrorType>
  readonly foregroundPermission: Effect.Effect<LocationPermissionResponse, ErrorType>
  readonly requestForegroundPermission: Effect.Effect<LocationPermissionResponse, ErrorType>
  readonly backgroundPermission: Effect.Effect<PermissionResponse, ErrorType>
  readonly requestBackgroundPermission: Effect.Effect<PermissionResponse, ErrorType>
  readonly servicesEnabled: Effect.Effect<boolean, ErrorType>
  readonly motionPermission: Effect.Effect<PermissionResponse, ErrorType>
  readonly requestMotionPermission: Effect.Effect<PermissionResponse, ErrorType>
  readonly motionActivity: Effect.Effect<MotionActivityObject, ErrorType>
  readonly motionActivities: (bufferSize?: number) => Stream.Stream<MotionActivityObject, ErrorType>
  readonly backgroundAvailable: Effect.Effect<boolean, ErrorType>
  readonly startLocationUpdates: (
    taskName: string,
    options?: LocationTaskOptions,
  ) => Effect.Effect<void, ErrorType>
  readonly stopLocationUpdates: (taskName: string) => Effect.Effect<void, ErrorType>
  readonly hasStartedLocationUpdates: (taskName: string) => Effect.Effect<boolean, ErrorType>
  readonly startGeofencing: (
    taskName: string,
    regions?: ReadonlyArray<LocationRegion>,
  ) => Effect.Effect<void, ErrorType>
  readonly stopGeofencing: (taskName: string) => Effect.Effect<void, ErrorType>
  readonly hasStartedGeofencing: (taskName: string) => Effect.Effect<boolean, ErrorType>
}

/**
 * Context service for Expo Location capabilities.
 *
 * @category services
 * @since 0.0.0
 */
export class Location extends Context.Service<Location, Service>()(
  "@better-native/location/Location",
) {}

const isUnavailable = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ERR_UNAVAILABLE"

const failure = (method: string, cause: unknown): ErrorType =>
  isUnavailable(cause)
    ? new LocationUnavailable({ method, cause })
    : new LocationFailure({ method, cause })

const native = <A>(method: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => failure(method, cause) })

const validated = <A>(
  method: string,
  effect: Effect.Effect<A, ErrorType>,
  predicate: (value: A) => boolean,
) =>
  effect.pipe(
    Effect.flatMap((value) =>
      predicate(value)
        ? Effect.succeed(value)
        : Effect.fail(new LocationFailure({ method, cause: "invalid native payload" })),
    ),
  )

const isPermission = (value: PermissionResponse): boolean =>
  typeof value === "object" &&
  value !== null &&
  typeof value.granted === "boolean" &&
  typeof value.canAskAgain === "boolean" &&
  typeof value.status === "string"

const isPosition = (value: LocationObject): boolean =>
  typeof value === "object" &&
  value !== null &&
  typeof value.timestamp === "number" &&
  typeof value.coords?.latitude === "number" &&
  typeof value.coords.longitude === "number"

const isHeading = (value: LocationHeadingObject): boolean =>
  typeof value === "object" &&
  value !== null &&
  typeof value.trueHeading === "number" &&
  typeof value.magHeading === "number" &&
  typeof value.accuracy === "number"

const isMotionActivity = (value: MotionActivityObject): boolean =>
  typeof value === "object" &&
  value !== null &&
  typeof value.timestamp === "number" &&
  typeof value.activities === "object" &&
  value.activities !== null

const isWebRuntime = () => typeof navigator !== "undefined" && typeof document !== "undefined"

const watcher = <A>(
  method: string,
  subscribe: (
    emit: (value: A) => void,
    fail: (reason: string) => void,
  ) => Promise<LocationSubscription>,
  bufferSize = 16,
  predicate: (value: A) => boolean = () => true,
) =>
  Stream.callback<A, ErrorType>(
    (queue) =>
      Effect.acquireRelease(
        native(method, () =>
          subscribe(
            (value) =>
              predicate(value)
                ? Queue.offerUnsafe(queue, value)
                : Queue.failCauseUnsafe(
                    queue,
                    Cause.fail(
                      new LocationFailure({ method, cause: "invalid native stream payload" }),
                    ),
                  ),
            (reason) =>
              Queue.failCauseUnsafe(
                queue,
                Cause.fail(new LocationFailure({ method, cause: reason })),
              ),
          ),
        ).pipe(Effect.tapError((error) => Queue.fail(queue, error))),
        (subscription) => Effect.sync(() => subscription.remove()),
      ),
    { bufferSize, strategy: "sliding" },
  )

const webPositions = (options: LocationOptions, bufferSize: number) =>
  Stream.callback<LocationObject, ErrorType>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          navigator.geolocation.watchPosition(
            (position) =>
              Queue.offerUnsafe(queue, {
                coords: {
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                  altitude: position.coords.altitude,
                  accuracy: position.coords.accuracy,
                  altitudeAccuracy: position.coords.altitudeAccuracy,
                  heading: position.coords.heading,
                  speed: position.coords.speed,
                },
                timestamp: position.timestamp,
              }),
            (cause) =>
              Queue.failCauseUnsafe(
                queue,
                Cause.fail(new LocationFailure({ method: "watchPositionAsync", cause })),
              ),
            {
              enableHighAccuracy:
                (options.accuracy ?? LocationAccuracy.Balanced) > LocationAccuracy.Balanced,
            },
          ),
        ),
        (watchId) => Effect.sync(() => navigator.geolocation.clearWatch(watchId)),
      ),
    { bufferSize, strategy: "sliding" },
  )

/**
 * Reads native provider availability and background-mode status.
 *
 * @category operations
 * @since 0.0.0
 */
export const getProviderStatusAsync = Effect.flatMap(Location, (service) => service.providerStatus)
/**
 * Requests Android high-accuracy network-provider mode.
 *
 * @category operations
 * @since 0.0.0
 */
export const enableNetworkProviderAsync = Effect.flatMap(
  Location,
  (service) => service.enableNetworkProvider,
)
/**
 * Reads one current position.
 *
 * @example
 * ```ts
 * import { Location } from "@better-native/location"
 * import * as Effect from "effect/Effect"
 *
 * const program = Location.getCurrentPositionAsync({
 *   accuracy: Location.Accuracy.Balanced,
 * }).pipe(Effect.provide(Location.live))
 * ```
 *
 * @category operations
 * @since 0.0.0
 */
export const getCurrentPositionAsync = (options?: LocationOptions) =>
  Effect.flatMap(Location, (service) => service.currentPosition(options))
/**
 * Reads the matching last-known position, when present.
 *
 * @category operations
 * @since 0.0.0
 */
export const getLastKnownPositionAsync = (options?: LocationLastKnownOptions) =>
  Effect.flatMap(Location, (service) => service.lastKnownPosition(options))
/**
 * Streams foreground position updates and removes the Expo subscription when its Scope closes.
 *
 * @example
 * ```ts
 * import { Location } from "@better-native/location"
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 *
 * const first = Location.watchPositionAsync({ bufferSize: 16 }).pipe(
 *   Stream.runHead,
 *   Effect.provide(Location.live),
 * )
 * ```
 *
 * @category streams
 * @since 0.0.0
 */
export const watchPositionAsync = (options: LocationStreamOptions = {}) => {
  const { bufferSize = 16, ...locationOptions } = options
  return Stream.unwrap(
    Effect.map(Location, (service) => service.positions(locationOptions, bufferSize)),
  )
}
/**
 * Reads one usable compass heading.
 *
 * @category operations
 * @since 0.0.0
 */
export const getHeadingAsync = Effect.flatMap(Location, (service) => service.heading)
/**
 * Streams compass headings and removes the Expo subscription when its Scope closes.
 *
 * @category streams
 * @since 0.0.0
 */
export const watchHeadingAsync = (options: SensorStreamOptions = {}) =>
  Stream.unwrap(Effect.map(Location, (service) => service.headings(options.bufferSize)))
/**
 * Forward-geocodes an address. Web preserves Expo's empty-array behavior.
 *
 * @category operations
 * @since 0.0.0
 */
export const geocodeAsync = (address: string) =>
  Effect.flatMap(Location, (service) => service.geocode(address))
/**
 * Reverse-geocodes coordinates. Web preserves Expo's empty-array behavior.
 *
 * @category operations
 * @since 0.0.0
 */
export const reverseGeocodeAsync = (
  location: Pick<LocationGeocodedLocation, "latitude" | "longitude">,
) => Effect.flatMap(Location, (service) => service.reverseGeocode(location))
/**
 * Reads foreground location permission.
 *
 * @category permissions
 * @since 0.0.0
 */
export const getForegroundPermissionsAsync = Effect.flatMap(
  Location,
  (service) => service.foregroundPermission,
)
/**
 * Requests foreground location permission.
 *
 * @category permissions
 * @since 0.0.0
 */
export const requestForegroundPermissionsAsync = Effect.flatMap(
  Location,
  (service) => service.requestForegroundPermission,
)
/**
 * Reads background location permission.
 *
 * @category permissions
 * @since 0.0.0
 */
export const getBackgroundPermissionsAsync = Effect.flatMap(
  Location,
  (service) => service.backgroundPermission,
)
/**
 * Requests background location permission after foreground permission is granted.
 *
 * @category permissions
 * @since 0.0.0
 */
export const requestBackgroundPermissionsAsync = Effect.flatMap(
  Location,
  (service) => service.requestBackgroundPermission,
)
/**
 * Checks whether device location services are enabled.
 *
 * @category operations
 * @since 0.0.0
 */
export const hasServicesEnabledAsync = Effect.flatMap(
  Location,
  (service) => service.servicesEnabled,
)
/**
 * Reads motion-activity permission.
 *
 * @category permissions
 * @since 0.0.0
 */
export const getMotionActivityPermissionsAsync = Effect.flatMap(
  Location,
  (service) => service.motionPermission,
)
/**
 * Requests motion-activity permission.
 *
 * @category permissions
 * @since 0.0.0
 */
export const requestMotionActivityPermissionsAsync = Effect.flatMap(
  Location,
  (service) => service.requestMotionPermission,
)
/**
 * Reads one motion-activity snapshot.
 *
 * @category operations
 * @since 0.0.0
 */
export const getMotionActivityAsync = Effect.flatMap(Location, (service) => service.motionActivity)
/**
 * Streams foreground motion activity and removes the Expo subscription when its Scope closes.
 *
 * @category streams
 * @since 0.0.0
 */
export const watchMotionActivityAsync = (options: SensorStreamOptions = {}) =>
  Stream.unwrap(Effect.map(Location, (service) => service.motionActivities(options.bufferSize)))
/**
 * Checks whether the current native configuration supports background location.
 *
 * @category operations
 * @since 0.0.0
 */
export const isBackgroundLocationAvailableAsync = Effect.flatMap(
  Location,
  (service) => service.backgroundAvailable,
)
/**
 * Starts a persistent Task Manager background-location registration. It is not Scope-owned.
 *
 * @category background
 * @since 0.0.0
 */
export const startLocationUpdatesAsync = (taskName: string, options?: LocationTaskOptions) =>
  Effect.flatMap(Location, (service) => service.startLocationUpdates(taskName, options))
/**
 * Stops a persistent background-location registration.
 *
 * @category background
 * @since 0.0.0
 */
export const stopLocationUpdatesAsync = (taskName: string) =>
  Effect.flatMap(Location, (service) => service.stopLocationUpdates(taskName))
/**
 * Checks whether background location updates are registered.
 *
 * @category background
 * @since 0.0.0
 */
export const hasStartedLocationUpdatesAsync = (taskName: string) =>
  Effect.flatMap(Location, (service) => service.hasStartedLocationUpdates(taskName))
/**
 * Starts or replaces persistent geofencing regions for a globally defined task.
 *
 * @category background
 * @since 0.0.0
 */
export const startGeofencingAsync = (
  taskName: string,
  regions: ReadonlyArray<LocationRegion> = [],
) =>
  regions.length === 0
    ? Effect.fail(
        new LocationFailure({
          method: "startGeofencingAsync",
          cause: "at least one geofencing region is required",
        }),
      )
    : Effect.flatMap(Location, (service) => service.startGeofencing(taskName, regions))
/**
 * Stops persistent geofencing for a task.
 *
 * @category background
 * @since 0.0.0
 */
export const stopGeofencingAsync = (taskName: string) =>
  Effect.flatMap(Location, (service) => service.stopGeofencing(taskName))
/**
 * Checks whether geofencing is registered for a task.
 *
 * @category background
 * @since 0.0.0
 */
export const hasStartedGeofencingAsync = (taskName: string) =>
  Effect.flatMap(Location, (service) => service.hasStartedGeofencing(taskName))

/**
 * Persistently starts background location for a task proven to be defined at module scope.
 *
 * @category background
 * @since 0.0.0
 */
export const startLocationUpdates = (definition: TaskDefinition, options?: LocationTaskOptions) =>
  startLocationUpdatesAsync(definition.name, options)

/**
 * Persistently starts geofencing for a task proven to be defined at module scope.
 *
 * @category background
 * @since 0.0.0
 */
export const startGeofencing = (
  definition: TaskDefinition,
  regions: ReadonlyArray<LocationRegion>,
) => startGeofencingAsync(definition.name, regions)

const nativePositions = (options: LocationOptions = {}, bufferSize = 16) =>
  watcher<LocationObject>(
    "watchPositionAsync",
    (emit, fail) => ExpoLocation.watchPositionAsync(options, emit, fail),
    bufferSize,
    isPosition,
  )
const nativeHeadings = (bufferSize = 16) =>
  watcher<LocationHeadingObject>(
    "watchHeadingAsync",
    (emit, fail) => ExpoLocation.watchHeadingAsync(emit, fail),
    bufferSize,
    isHeading,
  )
const nativeMotionActivities = (bufferSize = 16) =>
  watcher<MotionActivityObject>(
    "watchMotionActivityAsync",
    (emit, fail) => ExpoLocation.watchMotionActivityAsync(emit, fail),
    bufferSize,
    isMotionActivity,
  )

const positionStream = (
  method: "getCurrentPositionAsync" | "watchPositionAsync",
  options: LocationOptions | undefined,
  bufferSize: number,
) => {
  if (!isWebRuntime()) return nativePositions(options, bufferSize)
  if ("geolocation" in navigator) return webPositions(options ?? {}, bufferSize)
  return Stream.fail(
    new LocationUnavailable({ method, cause: "browser geolocation is unavailable" }),
  )
}

const backgroundAvailable = native<unknown>(
  "isBackgroundLocationAvailableAsync",
  ExpoLocation.isBackgroundLocationAvailableAsync,
).pipe(
  Effect.flatMap((value) => {
    if (typeof value === "boolean") return Effect.succeed(value)
    if (isWebRuntime() && value === undefined) return Effect.succeed(false)
    return Effect.fail(
      new LocationFailure({
        method: "isBackgroundLocationAvailableAsync",
        cause: "invalid native payload",
      }),
    )
  }),
)

const firstStreamValue = <A>(method: string, stream: Stream.Stream<A, ErrorType>) =>
  Stream.runHead(stream).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(new LocationFailure({ method, cause: "native stream ended before a value" })),
        onSome: Effect.succeed,
      }),
    ),
  )

/**
 * Live Location service backed by Expo Location.
 *
 * @category layers
 * @since 0.0.0
 */
export const live = Layer.succeed(
  Location,
  Location.of({
    providerStatus: validated(
      "getProviderStatusAsync",
      native("getProviderStatusAsync", ExpoLocation.getProviderStatusAsync),
      (value) =>
        typeof value === "object" &&
        value !== null &&
        typeof value.locationServicesEnabled === "boolean",
    ),
    enableNetworkProvider: native(
      "enableNetworkProviderAsync",
      ExpoLocation.enableNetworkProviderAsync,
    ),
    currentPosition: (options) =>
      positionStream("getCurrentPositionAsync", options, 1).pipe(
        Stream.runHead,
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new LocationFailure({
                  method: "getCurrentPositionAsync",
                  cause: "position stream ended",
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      ),
    lastKnownPosition: (options) =>
      validated(
        "getLastKnownPositionAsync",
        native("getLastKnownPositionAsync", () => ExpoLocation.getLastKnownPositionAsync(options)),
        (value) => value === null || isPosition(value),
      ),
    positions: (options, bufferSize) =>
      positionStream("watchPositionAsync", options, bufferSize ?? 16),
    heading: isWebRuntime()
      ? Effect.fail(
          new LocationUnavailable({ method: "getHeadingAsync", cause: "unsupported on web" }),
        )
      : firstStreamValue(
          "getHeadingAsync",
          nativeHeadings().pipe(
            Stream.zipWithIndex,
            Stream.filter(([heading, index]) => heading.accuracy > 1 || index >= 6),
            Stream.map(([heading]) => heading),
          ),
        ),
    headings: (bufferSize) =>
      isWebRuntime()
        ? Stream.fail(
            new LocationUnavailable({ method: "watchHeadingAsync", cause: "unsupported on web" }),
          )
        : nativeHeadings(bufferSize),
    geocode: (address) => native("geocodeAsync", () => ExpoLocation.geocodeAsync(address)),
    reverseGeocode: (location) =>
      native("reverseGeocodeAsync", () => ExpoLocation.reverseGeocodeAsync(location)),
    foregroundPermission: validated(
      "getForegroundPermissionsAsync",
      native("getForegroundPermissionsAsync", ExpoLocation.getForegroundPermissionsAsync),
      isPermission,
    ),
    requestForegroundPermission: validated(
      "requestForegroundPermissionsAsync",
      native("requestForegroundPermissionsAsync", ExpoLocation.requestForegroundPermissionsAsync),
      isPermission,
    ),
    backgroundPermission: validated(
      "getBackgroundPermissionsAsync",
      native("getBackgroundPermissionsAsync", ExpoLocation.getBackgroundPermissionsAsync),
      isPermission,
    ),
    requestBackgroundPermission: validated(
      "requestBackgroundPermissionsAsync",
      native("requestBackgroundPermissionsAsync", ExpoLocation.requestBackgroundPermissionsAsync),
      isPermission,
    ),
    servicesEnabled: validated(
      "hasServicesEnabledAsync",
      native("hasServicesEnabledAsync", ExpoLocation.hasServicesEnabledAsync),
      (value) => typeof value === "boolean",
    ),
    motionPermission: validated(
      "getMotionActivityPermissionsAsync",
      native("getMotionActivityPermissionsAsync", ExpoLocation.getMotionActivityPermissionsAsync),
      isPermission,
    ),
    requestMotionPermission: validated(
      "requestMotionActivityPermissionsAsync",
      native(
        "requestMotionActivityPermissionsAsync",
        ExpoLocation.requestMotionActivityPermissionsAsync,
      ),
      isPermission,
    ),
    motionActivity: isWebRuntime()
      ? Effect.fail(
          new LocationUnavailable({
            method: "getMotionActivityAsync",
            cause: "unsupported on web",
          }),
        )
      : firstStreamValue("getMotionActivityAsync", nativeMotionActivities()),
    motionActivities: (bufferSize) =>
      isWebRuntime()
        ? Stream.fail(
            new LocationUnavailable({
              method: "watchMotionActivityAsync",
              cause: "unsupported on web",
            }),
          )
        : nativeMotionActivities(bufferSize),
    backgroundAvailable,
    startLocationUpdates: (taskName, options) =>
      native("startLocationUpdatesAsync", () =>
        ExpoLocation.startLocationUpdatesAsync(taskName, options),
      ),
    stopLocationUpdates: (taskName) =>
      native("stopLocationUpdatesAsync", () => ExpoLocation.stopLocationUpdatesAsync(taskName)),
    hasStartedLocationUpdates: (taskName) =>
      native("hasStartedLocationUpdatesAsync", () =>
        ExpoLocation.hasStartedLocationUpdatesAsync(taskName),
      ),
    startGeofencing: (taskName, regions) =>
      native("startGeofencingAsync", () =>
        ExpoLocation.startGeofencingAsync(taskName, [...(regions ?? [])]),
      ),
    stopGeofencing: (taskName) =>
      native("stopGeofencingAsync", () => ExpoLocation.stopGeofencingAsync(taskName)),
    hasStartedGeofencing: (taskName) =>
      native("hasStartedGeofencingAsync", () => ExpoLocation.hasStartedGeofencingAsync(taskName)),
  }),
)

/**
 * Atom containing the foreground permission query result. Refresh it after requesting permission.
 *
 * @category atoms
 * @since 0.0.0
 */
export const foregroundPermissionAtom = Atom.make(
  Stream.fromEffect(getForegroundPermissionsAsync).pipe(Stream.provide(live)),
)
/**
 * Atom containing the background permission query result. Refresh it after requesting permission.
 *
 * @category atoms
 * @since 0.0.0
 */
export const backgroundPermissionAtom = Atom.make(
  Stream.fromEffect(getBackgroundPermissionsAsync).pipe(Stream.provide(live)),
)
/**
 * Atom containing the motion-activity permission query result. Refresh it after requesting permission.
 *
 * @category atoms
 * @since 0.0.0
 */
export const motionActivityPermissionAtom = Atom.make(
  Stream.fromEffect(getMotionActivityPermissionsAsync).pipe(Stream.provide(live)),
)
