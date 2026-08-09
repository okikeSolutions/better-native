import { TaskManager, type TaskDefinition } from "@better-native/task-manager"
import * as Effect from "effect/Effect"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import type * as Scope from "effect/Scope"
import { BackgroundNotificationTaskResult, registerTaskAsync } from "./Notifications.ts"
import type { NotificationTaskPayload } from "./Types.ts"

/**
 * Defines an Effect background-notification task synchronously at module initialization.
 *
 * The returned token can be registered with {@link registerBackgroundTask}. Handler failures and
 * defects are converted to Expo's `Failed` result so the native task always completes.
 *
 * @example
 * ```ts
 * import { Notifications } from "@better-native/notifications"
 * import {
 *   defineBackgroundNotificationTask,
 *   registerBackgroundTask,
 * } from "@better-native/notifications/background"
 * import { TaskManager } from "@better-native/task-manager"
 * import * as Effect from "effect/Effect"
 * import * as Layer from "effect/Layer"
 * import * as ManagedRuntime from "effect/ManagedRuntime"
 *
 * const AppLive = Layer.merge(Notifications.live, TaskManager.live)
 * const runtime = ManagedRuntime.make(AppLive)
 *
 * const backgroundNotification = defineBackgroundNotificationTask(
 *   "background-notification",
 *   runtime,
 *   (payload) =>
 *     Effect.log(payload).pipe(
 *       Effect.as(Notifications.BackgroundNotificationTaskResult.NewData),
 *     ),
 * )
 *
 * void runtime.runPromise(registerBackgroundTask(backgroundNotification))
 * ```
 *
 * @category initialization
 * @since 0.0.0
 */
export const defineBackgroundNotificationTask = <R, E, ER>(
  name: string,
  runtime: ManagedRuntime.ManagedRuntime<R, ER>,
  handler: (
    payload: NotificationTaskPayload,
  ) => Effect.Effect<BackgroundNotificationTaskResult, E, R | Scope.Scope>,
): TaskDefinition =>
  TaskManager.defineTask<NotificationTaskPayload, BackgroundNotificationTaskResult, never, R, ER>(
    name,
    runtime,
    ({ data }) =>
      handler(data).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            Effect.logError("Background notification task failed", { cause, taskName: name }).pipe(
              Effect.as(BackgroundNotificationTaskResult.Failed),
            ),
          onSuccess: Effect.succeed,
        }),
      ),
  )

/**
 * Registers a typed module-scope background-notification definition.
 *
 * @category operations
 * @since 0.0.0
 */
export const registerBackgroundTask = (definition: TaskDefinition) =>
  registerTaskAsync(definition.name)
