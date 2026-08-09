let secret
let state

export const configureDxEval = (token) => {
  if (secret !== undefined)
    throw new Error("controlled expo-notifications state already configured")
  secret = token
  state = { listenerCalls: 0, removeCalls: 0 }
}

export const snapshotDxEval = (token) => {
  if (token !== secret || state === undefined) throw new Error("invalid controller token")
  return { ...state }
}

const control = () => {
  if (state === undefined) throw new Error("controlled expo-notifications state is unavailable")
  return state
}

export const AndroidAudioContentType = {}
export const AndroidAudioUsage = {}
export const AndroidImportance = {}
export const AndroidNotificationPriority = {}
export const AndroidNotificationVisibility = {}
export const BackgroundNotificationTaskResult = { NewData: 0, NoData: 1, Failed: 2 }
export const DEFAULT_ACTION_IDENTIFIER = "default"
export const IosAlertStyle = {}
export const IosAllowsPreviews = {}
export const IosAuthorizationStatus = {}
export class NotificationTimeoutError extends Error {}
export const PermissionStatus = {}
export const SchedulableTriggerInputTypes = {}

export const addNotificationReceivedListener = (listener) => {
  const current = control()
  current.listenerCalls += 1
  listener({ request: { identifier: "notification-1", content: {}, trigger: null }, date: 1 })
  return {
    remove: () => {
      current.removeCalls += 1
    },
  }
}

const emptyListener = () => ({ remove() {} })
export const addNotificationResponseClearedListener = emptyListener
export const addNotificationResponseReceivedListener = emptyListener
export const addNotificationsDroppedListener = emptyListener
export const addPushTokenListener = emptyListener
export const getLastNotificationResponseAsync = async () => null
export const getLastNotificationResponse = () => null
export const clearLastNotificationResponseAsync = async () => undefined
export const clearLastNotificationResponse = () => undefined
export const setNotificationHandler = () => undefined
const unsupported = async () => {
  throw Object.assign(new Error("unavailable"), { code: "ERR_UNAVAILABLE" })
}
export const getPermissionsAsync = unsupported
export const getDevicePushTokenAsync = unsupported
export const getExpoPushTokenAsync = unsupported
export const requestPermissionsAsync = unsupported
