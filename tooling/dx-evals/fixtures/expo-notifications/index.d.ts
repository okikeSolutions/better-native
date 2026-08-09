export type Notification = { readonly request: { readonly identifier: string } }
export type NotificationResponse = object
export type MaybeNotificationResponse = NotificationResponse | null | undefined
export type NotificationBehavior = object
export type NotificationTaskPayload = object
export type BackgroundNotificationTaskResult = number
export declare const BackgroundNotificationTaskResult: {
  readonly NewData: 0
  readonly NoData: 1
  readonly Failed: 2
}
export declare const DEFAULT_ACTION_IDENTIFIER: string
export declare const AndroidAudioContentType: object
export declare const AndroidAudioUsage: object
export declare const AndroidImportance: object
export declare const AndroidNotificationPriority: object
export declare const AndroidNotificationVisibility: object
export declare const IosAlertStyle: object
export declare const IosAllowsPreviews: object
export declare const IosAuthorizationStatus: object
export declare class NotificationTimeoutError extends Error {}
export declare const PermissionStatus: object
export declare const SchedulableTriggerInputTypes: object
export declare function addNotificationReceivedListener(listener: (value: Notification) => void): {
  remove(): void
}
export declare function addNotificationResponseClearedListener(listener: () => void): {
  remove(): void
}
export declare function addNotificationResponseReceivedListener(
  listener: (value: NotificationResponse) => void,
): { remove(): void }
export declare function addNotificationsDroppedListener(listener: () => void): { remove(): void }
export declare function addPushTokenListener(listener: (value: unknown) => void): { remove(): void }
export declare const getLastNotificationResponseAsync: () => Promise<NotificationResponse | null>
export declare const getLastNotificationResponse: () => NotificationResponse | null
export declare const clearLastNotificationResponseAsync: () => Promise<void>
export declare const clearLastNotificationResponse: () => void
export declare const setNotificationHandler: (...args: ReadonlyArray<unknown>) => void
export declare const getPermissionsAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const getDevicePushTokenAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const getExpoPushTokenAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export declare const requestPermissionsAsync: (...args: ReadonlyArray<unknown>) => Promise<never>
export type EventSubscription = { remove(): void }
export type NotificationHandlingError = Error
export type NotificationHandler = object
export type PermissionExpiration = string | number
export type PermissionResponse = object
export type PermissionStatus = string
