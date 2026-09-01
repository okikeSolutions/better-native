import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as ExpoNotifications from "expo-notifications"

/**
 * Expo's default notification action identifier.
 *
 * @category models
 * @since 0.0.0
 */
export const DEFAULT_ACTION_IDENTIFIER = ExpoNotifications.DEFAULT_ACTION_IDENTIFIER
/**
 * Android notification audio content types.
 *
 * @category models
 * @since 0.0.0
 */
export const AndroidAudioContentType = ExpoNotifications.AndroidAudioContentType
/**
 * Android notification audio usages.
 *
 * @category models
 * @since 0.0.0
 */
export const AndroidAudioUsage = ExpoNotifications.AndroidAudioUsage
/**
 * Android notification importance levels.
 *
 * @category models
 * @since 0.0.0
 */
export const AndroidImportance = ExpoNotifications.AndroidImportance
/**
 * Android notification priorities.
 *
 * @category models
 * @since 0.0.0
 */
export const AndroidNotificationPriority = ExpoNotifications.AndroidNotificationPriority
/**
 * Android notification visibility levels.
 *
 * @category models
 * @since 0.0.0
 */
export const AndroidNotificationVisibility = ExpoNotifications.AndroidNotificationVisibility
/**
 * Results returned by background notification handlers.
 *
 * @category models
 * @since 0.0.0
 */
export const BackgroundNotificationTaskResult = ExpoNotifications.BackgroundNotificationTaskResult
/**
 * iOS alert presentation styles.
 *
 * @category models
 * @since 0.0.0
 */
export const IosAlertStyle = ExpoNotifications.IosAlertStyle
/**
 * iOS preview visibility settings.
 *
 * @category models
 * @since 0.0.0
 */
export const IosAllowsPreviews = ExpoNotifications.IosAllowsPreviews
/**
 * iOS notification authorization states.
 *
 * @category models
 * @since 0.0.0
 */
export const IosAuthorizationStatus = ExpoNotifications.IosAuthorizationStatus
/**
 * Expo permission states.
 *
 * @category models
 * @since 0.0.0
 */
export const PermissionStatus = ExpoNotifications.PermissionStatus
/**
 * Notification scheduler trigger discriminants.
 *
 * @category models
 * @since 0.0.0
 */
export const SchedulableTriggerInputTypes = ExpoNotifications.SchedulableTriggerInputTypes
/**
 * Expo timeout error class retained for foreground-handler interoperability.
 *
 * @category errors
 * @since 0.0.0
 */
export const NotificationTimeoutError = ExpoNotifications.NotificationTimeoutError

/**
 * Android notification audio content type.
 *
 * @category models
 * @since 0.0.0
 */
export type AndroidAudioContentType = ExpoNotifications.AndroidAudioContentType
/**
 * Android notification audio usage.
 *
 * @category models
 * @since 0.0.0
 */
export type AndroidAudioUsage = ExpoNotifications.AndroidAudioUsage
/**
 * Android notification importance.
 *
 * @category models
 * @since 0.0.0
 */
export type AndroidImportance = ExpoNotifications.AndroidImportance
/**
 * Android notification priority.
 *
 * @category models
 * @since 0.0.0
 */
export type AndroidNotificationPriority = ExpoNotifications.AndroidNotificationPriority
/**
 * Android notification visibility.
 *
 * @category models
 * @since 0.0.0
 */
export type AndroidNotificationVisibility = ExpoNotifications.AndroidNotificationVisibility
/**
 * Background notification task result.
 *
 * @category models
 * @since 0.0.0
 */
export type BackgroundNotificationTaskResult = ExpoNotifications.BackgroundNotificationTaskResult
/**
 * iOS alert presentation style.
 *
 * @category models
 * @since 0.0.0
 */
export type IosAlertStyle = ExpoNotifications.IosAlertStyle
/**
 * iOS notification preview visibility.
 *
 * @category models
 * @since 0.0.0
 */
export type IosAllowsPreviews = ExpoNotifications.IosAllowsPreviews
/**
 * iOS notification authorization state.
 *
 * @category models
 * @since 0.0.0
 */
export type IosAuthorizationStatus = ExpoNotifications.IosAuthorizationStatus
/**
 * Expo permission state.
 *
 * @category models
 * @since 0.0.0
 */
export type PermissionStatus = ExpoNotifications.PermissionStatus
/**
 * Notification trigger discriminant.
 *
 * @category models
 * @since 0.0.0
 */
export type SchedulableTriggerInputTypes = ExpoNotifications.SchedulableTriggerInputTypes
/**
 * Foreground notification timeout error instance.
 *
 * @category errors
 * @since 0.0.0
 */
export type NotificationTimeoutError = ExpoNotifications.NotificationTimeoutError

/**
 * A typed failure reported by the Expo Notifications module.
 *
 * @category errors
 * @since 0.0.0
 */
export class NotificationsFailure extends Data.TaggedError("NotificationsFailure")<{
  readonly method: string
  readonly cause: unknown
}> {}

/**
 * A typed failure for an operation unavailable on the current platform.
 *
 * @category errors
 * @since 0.0.0
 */
export class NotificationsUnavailable extends Data.TaggedError("NotificationsUnavailable")<{
  readonly method: string
  readonly cause: unknown
}> {}

/**
 * Shared error channel for Effect-native notification operations.
 *
 * @category errors
 * @since 0.0.0
 */
export type NotificationsError = NotificationsUnavailable | NotificationsFailure

/**
 * Injectable Notifications service contract.
 *
 * @category services
 * @since 0.0.0
 */
export interface Service {
  readonly module: typeof ExpoNotifications
}

/**
 * Context tag for Effect-native Expo Notifications access.
 *
 * @category services
 * @since 0.0.0
 */
export class Notifications extends Context.Service<Notifications, Service>()(
  "@better-native/notifications/Notifications",
) {}

const isUnavailable = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  (cause.code === "ERR_UNAVAILABLE" || cause.code === "ERR_NOTIFICATIONS_UNAVAILABLE")

const classify = (method: string, cause: unknown): NotificationsError =>
  isUnavailable(cause)
    ? new NotificationsUnavailable({ method, cause })
    : new NotificationsFailure({ method, cause })

const call = <A>(method: string, run: (module: typeof ExpoNotifications) => Promise<A>) =>
  Effect.flatMap(Notifications, ({ module }) =>
    Effect.tryPromise({ try: () => run(module), catch: (cause) => classify(method, cause) }),
  )

const syncCall = <A>(method: string, run: (module: typeof ExpoNotifications) => A) =>
  Effect.flatMap(Notifications, ({ module }) =>
    Effect.try({ try: () => run(module), catch: (cause) => classify(method, cause) }),
  )

/**
 * Reads the native device push token.
 *
 * @category operations
 * @since 0.0.0
 */
export const getDevicePushTokenAsync = call("getDevicePushTokenAsync", (m) =>
  m.getDevicePushTokenAsync(),
)
/**
 * Removes the device from native push registration.
 *
 * @category operations
 * @since 0.0.0
 */
export const unregisterForNotificationsAsync = call("unregisterForNotificationsAsync", (m) =>
  m.unregisterForNotificationsAsync(),
)
/**
 * Obtains an Expo push token.
 *
 * @category operations
 * @since 0.0.0
 */
export const getExpoPushTokenAsync = (options?: ExpoNotifications.ExpoPushTokenOptions) =>
  call("getExpoPushTokenAsync", (m) => m.getExpoPushTokenAsync(options))
/**
 * Subscribes the device to an FCM topic on Android.
 *
 * @category operations
 * @since 0.0.0
 */
export const subscribeToTopicAsync = (topic: string) =>
  call("subscribeToTopicAsync", (m) => m.subscribeToTopicAsync(topic))
/**
 * Unsubscribes the device from an FCM topic on Android.
 *
 * @category operations
 * @since 0.0.0
 */
export const unsubscribeFromTopicAsync = (topic: string) =>
  call("unsubscribeFromTopicAsync", (m) => m.unsubscribeFromTopicAsync(topic))
/**
 * Lists notifications currently presented by the system.
 *
 * @category operations
 * @since 0.0.0
 */
export const getPresentedNotificationsAsync = call("getPresentedNotificationsAsync", (m) =>
  m.getPresentedNotificationsAsync(),
)
/**
 * Dismisses one presented notification.
 *
 * @category operations
 * @since 0.0.0
 */
export const dismissNotificationAsync = (identifier: string) =>
  call("dismissNotificationAsync", (m) => m.dismissNotificationAsync(identifier))
/**
 * Dismisses all presented notifications.
 *
 * @category operations
 * @since 0.0.0
 */
export const dismissAllNotificationsAsync = call("dismissAllNotificationsAsync", (m) =>
  m.dismissAllNotificationsAsync(),
)
/**
 * Lists Android notification channels.
 *
 * @category operations
 * @since 0.0.0
 */
export const getNotificationChannelsAsync = call("getNotificationChannelsAsync", (m) =>
  m.getNotificationChannelsAsync(),
)
/**
 * Reads one Android notification channel.
 *
 * @category operations
 * @since 0.0.0
 */
export const getNotificationChannelAsync = (channelId: string) =>
  call("getNotificationChannelAsync", (m) => m.getNotificationChannelAsync(channelId))
/**
 * Creates or updates an Android notification channel.
 *
 * @category operations
 * @since 0.0.0
 */
export const setNotificationChannelAsync = (
  channelId: string,
  channel: ExpoNotifications.NotificationChannelInput,
) => call("setNotificationChannelAsync", (m) => m.setNotificationChannelAsync(channelId, channel))
/**
 * Deletes one Android notification channel.
 *
 * @category operations
 * @since 0.0.0
 */
export const deleteNotificationChannelAsync = (channelId: string) =>
  call("deleteNotificationChannelAsync", (m) => m.deleteNotificationChannelAsync(channelId))
/**
 * Lists Android notification channel groups.
 *
 * @category operations
 * @since 0.0.0
 */
export const getNotificationChannelGroupsAsync = call("getNotificationChannelGroupsAsync", (m) =>
  m.getNotificationChannelGroupsAsync(),
)
/**
 * Reads one Android notification channel group.
 *
 * @category operations
 * @since 0.0.0
 */
export const getNotificationChannelGroupAsync = (groupId: string) =>
  call("getNotificationChannelGroupAsync", (m) => m.getNotificationChannelGroupAsync(groupId))
/**
 * Creates or updates an Android notification channel group.
 *
 * @category operations
 * @since 0.0.0
 */
export const setNotificationChannelGroupAsync = (
  groupId: string,
  group: ExpoNotifications.NotificationChannelGroupInput,
) =>
  call("setNotificationChannelGroupAsync", (m) =>
    m.setNotificationChannelGroupAsync(groupId, group),
  )
/**
 * Deletes one Android notification channel group.
 *
 * @category operations
 * @since 0.0.0
 */
export const deleteNotificationChannelGroupAsync = (groupId: string) =>
  call("deleteNotificationChannelGroupAsync", (m) => m.deleteNotificationChannelGroupAsync(groupId))
/**
 * Reads the application icon badge count.
 *
 * @category operations
 * @since 0.0.0
 */
export const getBadgeCountAsync = call("getBadgeCountAsync", (m) => m.getBadgeCountAsync())
/**
 * Updates the application icon badge count.
 *
 * @category operations
 * @since 0.0.0
 */
export const setBadgeCountAsync = (
  badgeCount: number,
  options?: Parameters<typeof ExpoNotifications.setBadgeCountAsync>[1],
) => call("setBadgeCountAsync", (m) => m.setBadgeCountAsync(badgeCount, options))
/**
 * Lists scheduled notification requests.
 *
 * @category operations
 * @since 0.0.0
 */
export const getAllScheduledNotificationsAsync = call("getAllScheduledNotificationsAsync", (m) =>
  m.getAllScheduledNotificationsAsync(),
)
/**
 * Schedules a local notification request.
 *
 * @category operations
 * @since 0.0.0
 */
export const scheduleNotificationAsync = (request: ExpoNotifications.NotificationRequestInput) =>
  call("scheduleNotificationAsync", (m) => m.scheduleNotificationAsync(request))
/**
 * Cancels one scheduled notification.
 *
 * @category operations
 * @since 0.0.0
 */
export const cancelScheduledNotificationAsync = (identifier: string) =>
  call("cancelScheduledNotificationAsync", (m) => m.cancelScheduledNotificationAsync(identifier))
/**
 * Cancels every scheduled notification.
 *
 * @category operations
 * @since 0.0.0
 */
export const cancelAllScheduledNotificationsAsync = call(
  "cancelAllScheduledNotificationsAsync",
  (m) => m.cancelAllScheduledNotificationsAsync(),
)
/**
 * Lists interactive notification categories.
 *
 * @category operations
 * @since 0.0.0
 */
export const getNotificationCategoriesAsync = call("getNotificationCategoriesAsync", (m) =>
  m.getNotificationCategoriesAsync(),
)
/**
 * Creates or updates an interactive notification category.
 *
 * @category operations
 * @since 0.0.0
 */
export const setNotificationCategoryAsync = (
  identifier: string,
  actions: ExpoNotifications.NotificationAction[],
  options?: ExpoNotifications.NotificationCategoryOptions,
) =>
  call("setNotificationCategoryAsync", (m) =>
    m.setNotificationCategoryAsync(identifier, actions, options),
  )
/**
 * Deletes an interactive notification category.
 *
 * @category operations
 * @since 0.0.0
 */
export const deleteNotificationCategoryAsync = (identifier: string) =>
  call("deleteNotificationCategoryAsync", (m) => m.deleteNotificationCategoryAsync(identifier))
/**
 * Resolves the next timestamp for a schedulable trigger.
 *
 * @category operations
 * @since 0.0.0
 */
export const getNextTriggerDateAsync = (
  trigger: ExpoNotifications.SchedulableNotificationTriggerInput,
) => call("getNextTriggerDateAsync", (m) => m.getNextTriggerDateAsync(trigger))
/**
 * Reads notification permission state.
 *
 * @category operations
 * @since 0.0.0
 */
export const getPermissionsAsync = call("getPermissionsAsync", (m) => m.getPermissionsAsync())
/**
 * Requests notification permission.
 *
 * @category operations
 * @since 0.0.0
 */
export const requestPermissionsAsync = (
  permissions?: ExpoNotifications.NotificationPermissionsRequest,
) => call("requestPermissionsAsync", (m) => m.requestPermissionsAsync(permissions))
/**
 * Enables or disables Expo's automatic server token registration.
 *
 * @category operations
 * @since 0.0.0
 */
export const setAutoServerRegistrationEnabledAsync = (enabled: boolean) =>
  call("setAutoServerRegistrationEnabledAsync", (m) =>
    m.setAutoServerRegistrationEnabledAsync(enabled),
  )
/**
 * Registers a module-scope Task Manager definition for background notifications.
 *
 * @category operations
 * @since 0.0.0
 */
export const registerTaskAsync = (taskName: string) =>
  call("registerTaskAsync", (m) => m.registerTaskAsync(taskName))
/**
 * Unregisters one background notification task.
 *
 * @category operations
 * @since 0.0.0
 */
export const unregisterTaskAsync = (taskName: string) =>
  call("unregisterTaskAsync", (m) => m.unregisterTaskAsync(taskName))
/**
 * Reads the last notification response synchronously inside an Effect.
 *
 * @category operations
 * @since 0.0.0
 */
export const getLastNotificationResponse = syncCall("getLastNotificationResponse", (m) =>
  m.getLastNotificationResponse(),
)
/**
 * Reads the last notification response asynchronously.
 *
 * @category operations
 * @since 0.0.0
 */
export const getLastNotificationResponseAsync = call("getLastNotificationResponseAsync", (m) =>
  m.getLastNotificationResponseAsync(),
)
/**
 * Clears the last notification response synchronously inside an Effect.
 *
 * @category operations
 * @since 0.0.0
 */
export const clearLastNotificationResponse = syncCall("clearLastNotificationResponse", (m) =>
  m.clearLastNotificationResponse(),
)
/**
 * Clears the last notification response asynchronously.
 *
 * @category operations
 * @since 0.0.0
 */
export const clearLastNotificationResponseAsync = call("clearLastNotificationResponseAsync", (m) =>
  m.clearLastNotificationResponseAsync(),
)

const listenerStream = <A>(
  method: string,
  subscribe: (module: typeof ExpoNotifications, emit: (value: A) => void) => { remove(): void },
): Stream.Stream<A, NotificationsError, Notifications> =>
  Stream.unwrap(
    Effect.map(Notifications, ({ module }) =>
      Stream.callback<A, NotificationsError>((queue) =>
        Effect.acquireRelease(
          Effect.try({
            try: () => subscribe(module, (value) => Queue.offerUnsafe(queue, value)),
            catch: (cause) => classify(method, cause),
          }).pipe(Effect.tapError((error) => Queue.fail(queue, error))),
          (subscription) => Effect.sync(() => subscription.remove()),
        ),
      ),
    ),
  )

/**
 * Scoped Stream of foreground notification deliveries.
 *
 * @example
 * ```ts
 * import { Notifications } from "@better-native/notifications"
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 *
 * const firstIdentifier = Notifications.addNotificationReceivedListener.pipe(
 *   Stream.runHead,
 *   Effect.provide(Notifications.live),
 * )
 * ```
 *
 * @category streams
 * @since 0.0.0
 */
export const addNotificationReceivedListener = listenerStream<ExpoNotifications.Notification>(
  "addNotificationReceivedListener",
  (m, emit) => m.addNotificationReceivedListener(emit),
)
/**
 * Scoped Stream emitted when the platform drops notifications.
 *
 * @category streams
 * @since 0.0.0
 */
export const addNotificationsDroppedListener = listenerStream<void>(
  "addNotificationsDroppedListener",
  (m, emit) => m.addNotificationsDroppedListener(() => emit(undefined)),
)
/**
 * Scoped Stream of user responses to notifications.
 *
 * @category streams
 * @since 0.0.0
 */
export const addNotificationResponseReceivedListener =
  listenerStream<ExpoNotifications.NotificationResponse>(
    "addNotificationResponseReceivedListener",
    (m, emit) => m.addNotificationResponseReceivedListener(emit),
  )
/**
 * Scoped Stream emitted when the last notification response is cleared.
 *
 * @category streams
 * @since 0.0.0
 */
export const addNotificationResponseClearedListener = listenerStream<void>(
  "addNotificationResponseClearedListener",
  (m, emit) => m.addNotificationResponseClearedListener(() => emit(undefined)),
)
/**
 * Scoped Stream of native device push-token changes.
 *
 * @category streams
 * @since 0.0.0
 */
export const addPushTokenListener = listenerStream<ExpoNotifications.DevicePushToken>(
  "addPushTokenListener",
  (m, emit) => m.addPushTokenListener(emit),
)

/**
 * Effect-native foreground notification handler.
 *
 * @category models
 * @since 0.0.0
 */
export interface EffectNotificationHandler<R, E> {
  readonly handleNotification: (
    notification: ExpoNotifications.Notification,
  ) => Effect.Effect<ExpoNotifications.NotificationBehavior, E, R | Scope.Scope>
  readonly handleSuccess?: (notificationId: string) => void
  readonly handleError?: (
    notificationId: string,
    error: ExpoNotifications.NotificationHandlingError,
  ) => void
}

/**
 * Installs an Effect handler synchronously at application-module initialization.
 *
 * Keep the supplied runtime alive while notifications may arrive. Every invocation receives a
 * fresh child Scope, while Expo retains its native three-second response deadline.
 *
 * @category initialization
 * @since 0.0.0
 */
export const setNotificationHandler = <R, E, ER>(
  runtime: ManagedRuntime.ManagedRuntime<R, ER>,
  handler: EffectNotificationHandler<R, E> | null,
): void =>
  ExpoNotifications.setNotificationHandler(
    handler === null
      ? null
      : {
          handleNotification: (notification) =>
            runtime.runPromise(Effect.scoped(handler.handleNotification(notification))),
          ...(handler.handleSuccess === undefined ? {} : { handleSuccess: handler.handleSuccess }),
          ...(handler.handleError === undefined ? {} : { handleError: handler.handleError }),
        },
  )

/**
 * Live Notifications service backed by the Expo module.
 *
 * @category layers
 * @since 0.0.0
 */
export const live = Layer.succeed(Notifications, Notifications.of({ module: ExpoNotifications }))

const responseChanges: Stream.Stream<
  ExpoNotifications.MaybeNotificationResponse,
  NotificationsError,
  Notifications
> = Stream.unwrap(
  Effect.map(Notifications, ({ module }) =>
    Stream.callback<ExpoNotifications.MaybeNotificationResponse, NotificationsError>((queue) => {
      let current: ExpoNotifications.MaybeNotificationResponse = undefined

      const emit = (response: ExpoNotifications.NotificationResponse | null) => {
        let next = current
        if (response === null) next = null
        else if (
          current == null ||
          current.notification.request.identifier !== response.notification.request.identifier
        ) {
          next = response
        }
        if (next !== current) {
          current = next
          Queue.offerUnsafe(queue, next)
        }
      }

      const acquire = (
        method: string,
        subscribe: () => { remove(): void },
      ): Effect.Effect<unknown, NotificationsError, Scope.Scope> =>
        Effect.acquireRelease(
          Effect.try({ try: subscribe, catch: (cause) => classify(method, cause) }).pipe(
            Effect.tapError((error) => Queue.fail(queue, error)),
          ),
          (subscription) => Effect.sync(() => subscription.remove()),
        )

      return Effect.gen(function* () {
        const initial = yield* Effect.try({
          try: () => module.getLastNotificationResponse(),
          catch: (cause) => classify("getLastNotificationResponse", cause),
        }).pipe(Effect.tapError((error) => Queue.fail(queue, error)))
        emit(initial)
        yield* acquire("addNotificationResponseReceivedListener", () =>
          module.addNotificationResponseReceivedListener(emit),
        )
        yield* acquire("addNotificationResponseClearedListener", () =>
          module.addNotificationResponseClearedListener(() => emit(null)),
        )
      })
    }),
  ),
)

/**
 * Atom counterpart to Expo's `useLastNotificationResponse` hook.
 *
 * Its `AsyncResult.Initial` state corresponds to Expo's initial `undefined`. It then hydrates from
 * native state, follows response and clear events in delivery order, and removes both listeners
 * when its final subscriber releases it.
 *
 * @category atoms
 * @since 0.0.0
 */
export const lastNotificationResponseAtom = Atom.make(responseChanges.pipe(Stream.provide(live)))
