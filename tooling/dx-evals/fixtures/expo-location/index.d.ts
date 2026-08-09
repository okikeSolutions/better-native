export declare const Accuracy: { readonly Balanced: 3 }
export declare const LocationAccuracy: typeof Accuracy
export declare const ActivityType: object
export declare const LocationActivityType: object
export declare const GeofencingEventType: object
export declare const LocationGeofencingEventType: object
export declare const GeofencingRegionState: object
export declare const LocationGeofencingRegionState: object
export declare const MotionActivityConfidence: object
export declare const MotionActivityType: object
export declare const PermissionStatus: object
export type LocationOptions = { readonly accuracy?: number }
export type LocationObject = {
  readonly coords: {
    readonly latitude: number
    readonly longitude: number
    readonly altitude: number | null
    readonly accuracy: number | null
    readonly altitudeAccuracy: number | null
    readonly heading: number | null
    readonly speed: number | null
  }
  readonly timestamp: number
}
export type LocationSubscription = { readonly remove: () => void }
export type LocationLastKnownOptions = object
export type LocationTaskOptions = object
export type LocationTaskServiceOptions = object
export type LocationRegion = {
  readonly latitude: number
  readonly longitude: number
  readonly radius: number
}
export type LocationObjectCoords = LocationObject["coords"]
export type LocationCallback = (value: LocationObject) => void
export type LocationErrorCallback = (reason: string) => void
export type LocationProviderStatus = {
  readonly locationServicesEnabled: boolean
  readonly backgroundModeEnabled?: boolean
}
export type LocationHeadingObject = {
  readonly trueHeading: number
  readonly magHeading: number
  readonly accuracy: number
}
export type LocationHeadingCallback = (value: LocationHeadingObject) => void
export type LocationGeocodedLocation = { readonly latitude: number; readonly longitude: number }
export type LocationGeocodedAddress = object
export type PermissionResponse = {
  readonly status: string
  readonly granted: boolean
  readonly canAskAgain: boolean
  readonly expires: string | number
}
export type LocationPermissionResponse = PermissionResponse
export type PermissionHookOptions<Options extends object> = Options
export type PermissionExpiration = string | number
export type PermissionDetailsLocationIOS = object
export type PermissionDetailsLocationAndroid = object
export type MotionActivityState = object
export type MotionActivityObject = { readonly activities: object; readonly timestamp: number }
export type MotionActivityCallback = (value: MotionActivityObject) => void
export type LocationActivityType = number
export type LocationAccuracy = number
export type LocationGeofencingEventType = number
export type LocationGeofencingRegionState = number
export type MotionActivityConfidence = number
export type MotionActivityType = string
export type PermissionStatus = string
export declare function watchPositionAsync(
  options: LocationOptions,
  emit: LocationCallback,
  fail?: LocationErrorCallback,
): Promise<LocationSubscription>
export declare const getProviderStatusAsync: () => Promise<LocationProviderStatus>
export declare const hasServicesEnabledAsync: () => Promise<boolean>
export declare const isBackgroundLocationAvailableAsync: () => Promise<boolean>
export declare const getForegroundPermissionsAsync: () => Promise<LocationPermissionResponse>
export declare const getBackgroundPermissionsAsync: () => Promise<PermissionResponse>
export declare const getMotionActivityPermissionsAsync: () => Promise<PermissionResponse>
export declare const enableNetworkProviderAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const getCurrentPositionAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const getLastKnownPositionAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const getHeadingAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const watchHeadingAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const geocodeAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const reverseGeocodeAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const requestForegroundPermissionsAsync: (
  ...args: ReadonlyArray<unknown>
) => Promise<never>
export declare const requestBackgroundPermissionsAsync: (
  ...args: ReadonlyArray<unknown>
) => Promise<never>
export declare const requestMotionActivityPermissionsAsync: (
  ...args: ReadonlyArray<unknown>
) => Promise<never>
export declare const getMotionActivityAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const watchMotionActivityAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const startLocationUpdatesAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const stopLocationUpdatesAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const hasStartedLocationUpdatesAsync: (
  ...args: ReadonlyArray<unknown>
) => Promise<boolean>
export declare const startGeofencingAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const stopGeofencingAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const hasStartedGeofencingAsync: (
  ...args: ReadonlyArray<unknown>
) => Promise<boolean>
