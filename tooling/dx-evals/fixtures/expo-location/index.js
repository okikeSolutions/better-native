let secret
let state

export const configureDxEval = (token) => {
  if (secret !== undefined) throw new Error("controlled expo-location state already configured")
  secret = token
  state = { watchCalls: 0, removeCalls: 0 }
}

export const snapshotDxEval = (token) => {
  if (token !== secret || state === undefined) throw new Error("invalid controller token")
  return { ...state }
}

const control = () => {
  if (state === undefined) throw new Error("controlled expo-location state is unavailable")
  return state
}

export const Accuracy = { Balanced: 3 }
export const LocationAccuracy = Accuracy
export const ActivityType = { Other: 1 }
export const LocationActivityType = ActivityType
export const GeofencingEventType = { Enter: 1, Exit: 2 }
export const LocationGeofencingEventType = GeofencingEventType
export const GeofencingRegionState = { Unknown: 0, Inside: 1, Outside: 2 }
export const LocationGeofencingRegionState = GeofencingRegionState
export const MotionActivityConfidence = { Low: 0, Medium: 1, High: 2 }
export const MotionActivityType = { Unknown: "unknown" }
export const PermissionStatus = {
  GRANTED: "granted",
  DENIED: "denied",
  UNDETERMINED: "undetermined",
}

export const watchPositionAsync = async (options, emit) => {
  const current = control()
  current.watchCalls += 1
  if (options?.accuracy !== Accuracy.Balanced) throw new Error("balanced accuracy required")
  emit({
    coords: {
      latitude: 48.2,
      longitude: 16.37,
      altitude: null,
      accuracy: 5,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: 1,
  })
  return {
    remove: () => {
      current.removeCalls += 1
    },
  }
}

const unsupported = async () => {
  throw Object.assign(new Error("unavailable"), { code: "ERR_UNAVAILABLE" })
}
export const getProviderStatusAsync = async () => ({ locationServicesEnabled: true })
export const hasServicesEnabledAsync = async () => true
export const isBackgroundLocationAvailableAsync = async () => false
export const getForegroundPermissionsAsync = async () => ({
  status: "granted",
  granted: true,
  canAskAgain: true,
  expires: "never",
})
export const getBackgroundPermissionsAsync = getForegroundPermissionsAsync
export const getMotionActivityPermissionsAsync = getForegroundPermissionsAsync
export const enableNetworkProviderAsync = unsupported
export const getCurrentPositionAsync = unsupported
export const getLastKnownPositionAsync = unsupported
export const getHeadingAsync = unsupported
export const watchHeadingAsync = unsupported
export const geocodeAsync = unsupported
export const reverseGeocodeAsync = unsupported
export const requestForegroundPermissionsAsync = unsupported
export const requestBackgroundPermissionsAsync = unsupported
export const requestMotionActivityPermissionsAsync = unsupported
export const getMotionActivityAsync = unsupported
export const watchMotionActivityAsync = unsupported
export const startLocationUpdatesAsync = unsupported
export const stopLocationUpdatesAsync = unsupported
export const hasStartedLocationUpdatesAsync = async () => false
export const startGeofencingAsync = unsupported
export const stopGeofencingAsync = unsupported
export const hasStartedGeofencingAsync = async () => false
