import { beforeEach, describe, expect, it, vi } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import type { NotificationsError } from "../src/Notifications.ts"

/* oxlint-disable effecttsgo/strict-effect-provide -- test runtime entry points */

const notificationMocks = vi.hoisted(() => ({
  addNotificationReceivedListener: vi.fn(),
  addNotificationResponseClearedListener: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(),
  addNotificationsDroppedListener: vi.fn(),
  addPushTokenListener: vi.fn(),
  cancelAllScheduledNotificationsAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  deleteNotificationCategoryAsync: vi.fn(),
  deleteNotificationChannelAsync: vi.fn(),
  deleteNotificationChannelGroupAsync: vi.fn(),
  dismissAllNotificationsAsync: vi.fn(),
  dismissNotificationAsync: vi.fn(),
  getAllScheduledNotificationsAsync: vi.fn(),
  getBadgeCountAsync: vi.fn(),
  getDevicePushTokenAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  getNextTriggerDateAsync: vi.fn(),
  getNotificationCategoriesAsync: vi.fn(),
  getNotificationChannelAsync: vi.fn(),
  getNotificationChannelGroupAsync: vi.fn(),
  getNotificationChannelGroupsAsync: vi.fn(),
  getNotificationChannelsAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  getPresentedNotificationsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  setAutoServerRegistrationEnabledAsync: vi.fn(),
  setBadgeCountAsync: vi.fn(),
  setNotificationCategoryAsync: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  setNotificationChannelGroupAsync: vi.fn(),
  subscribeToTopicAsync: vi.fn(),
  unregisterForNotificationsAsync: vi.fn(),
  unsubscribeFromTopicAsync: vi.fn(),
  getLastNotificationResponse: vi.fn(),
  getLastNotificationResponseAsync: vi.fn(),
  clearLastNotificationResponse: vi.fn(),
  clearLastNotificationResponseAsync: vi.fn(),
  registerTaskAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
  setNotificationHandler: vi.fn(),
}))
const taskManagerMocks = vi.hoisted(() => ({
  defineTask: vi.fn(),
  isAvailableAsync: vi.fn(),
  isTaskDefined: vi.fn(),
  isTaskRegisteredAsync: vi.fn(),
  getTaskOptionsAsync: vi.fn(),
  getRegisteredTasksAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
  unregisterAllTasksAsync: vi.fn(),
}))

vi.mock("expo-notifications", () => ({
  AndroidAudioContentType: {},
  AndroidAudioUsage: {},
  AndroidImportance: {},
  AndroidNotificationPriority: {},
  AndroidNotificationVisibility: {},
  BackgroundNotificationTaskResult: { NewData: 0, NoData: 1, Failed: 2 },
  DEFAULT_ACTION_IDENTIFIER: "default",
  IosAlertStyle: {},
  IosAllowsPreviews: {},
  IosAuthorizationStatus: {},
  NotificationTimeoutError: class NotificationTimeoutError extends Error {},
  PermissionStatus: {},
  SchedulableTriggerInputTypes: {},
  ...notificationMocks,
}))
vi.mock("expo-task-manager", () => taskManagerMocks)

const Notifications = await import("../src/Notifications.ts")
const NotificationBackground = await import("../src/Background.ts")

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Notifications.live)) as Effect.Effect<A, E>)

describe("@better-native/notifications", () => {
  beforeEach(() => vi.clearAllMocks())

  it("forwards representative token, permission, scheduler, and response operations", async () => {
    const token = { type: "android", data: "token" }
    const permission = { status: "granted", granted: true, canAskAgain: true, expires: "never" }
    const response = { actionIdentifier: "default" }
    notificationMocks.getDevicePushTokenAsync.mockResolvedValueOnce(token)
    notificationMocks.getPermissionsAsync.mockResolvedValueOnce(permission)
    notificationMocks.scheduleNotificationAsync.mockResolvedValueOnce("scheduled")
    notificationMocks.getLastNotificationResponse.mockReturnValueOnce(response)
    notificationMocks.clearLastNotificationResponseAsync.mockResolvedValueOnce(undefined)

    await expect(run(Notifications.getDevicePushTokenAsync)).resolves.toBe(token)
    await expect(run(Notifications.getPermissionsAsync)).resolves.toBe(permission)
    await expect(
      run(
        Notifications.scheduleNotificationAsync({
          content: { title: "hello" },
          trigger: null,
        }),
      ),
    ).resolves.toBe("scheduled")
    await expect(run(Notifications.getLastNotificationResponse)).resolves.toBe(response)
    await expect(run(Notifications.clearLastNotificationResponseAsync)).resolves.toBeUndefined()
  })

  it("forwards token, presentation, and Android channel operation families", async () => {
    const result = { native: true }
    const channel = { name: "alerts", importance: 4 }
    const group = { name: "account" }
    const cases = [
      [
        Notifications.unregisterForNotificationsAsync,
        notificationMocks.unregisterForNotificationsAsync,
        [],
      ],
      [
        Notifications.getExpoPushTokenAsync({ projectId: "project" }),
        notificationMocks.getExpoPushTokenAsync,
        [{ projectId: "project" }],
      ],
      [
        Notifications.subscribeToTopicAsync("news"),
        notificationMocks.subscribeToTopicAsync,
        ["news"],
      ],
      [
        Notifications.unsubscribeFromTopicAsync("news"),
        notificationMocks.unsubscribeFromTopicAsync,
        ["news"],
      ],
      [
        Notifications.getPresentedNotificationsAsync,
        notificationMocks.getPresentedNotificationsAsync,
        [],
      ],
      [
        Notifications.dismissNotificationAsync("shown"),
        notificationMocks.dismissNotificationAsync,
        ["shown"],
      ],
      [
        Notifications.dismissAllNotificationsAsync,
        notificationMocks.dismissAllNotificationsAsync,
        [],
      ],
      [
        Notifications.getNotificationChannelsAsync,
        notificationMocks.getNotificationChannelsAsync,
        [],
      ],
      [
        Notifications.getNotificationChannelAsync("alerts"),
        notificationMocks.getNotificationChannelAsync,
        ["alerts"],
      ],
      [
        Notifications.setNotificationChannelAsync("alerts", channel),
        notificationMocks.setNotificationChannelAsync,
        ["alerts", channel],
      ],
      [
        Notifications.deleteNotificationChannelAsync("alerts"),
        notificationMocks.deleteNotificationChannelAsync,
        ["alerts"],
      ],
      [
        Notifications.getNotificationChannelGroupsAsync,
        notificationMocks.getNotificationChannelGroupsAsync,
        [],
      ],
      [
        Notifications.getNotificationChannelGroupAsync("account"),
        notificationMocks.getNotificationChannelGroupAsync,
        ["account"],
      ],
      [
        Notifications.setNotificationChannelGroupAsync("account", group),
        notificationMocks.setNotificationChannelGroupAsync,
        ["account", group],
      ],
      [
        Notifications.deleteNotificationChannelGroupAsync("account"),
        notificationMocks.deleteNotificationChannelGroupAsync,
        ["account"],
      ],
    ] as const

    for (const [effect, mock, args] of cases) {
      mock.mockResolvedValueOnce(result)
      await expect(run(effect as Effect.Effect<unknown, NotificationsError, never>)).resolves.toBe(
        result,
      )
      expect(mock).toHaveBeenLastCalledWith(...args)
    }
  })

  it("forwards badge, scheduling, category, permission, and task operation families", async () => {
    const result = { native: true }
    const badgeOptions = { web: {} } as unknown as NonNullable<
      Parameters<(typeof Notifications)["setBadgeCountAsync"]>[1]
    >
    const request = { content: { title: "hello" }, trigger: null }
    const action = { identifier: "open", buttonTitle: "Open" }
    const categoryOptions = { allowInCarPlay: true }
    const trigger = {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 9,
      minute: 30,
    } as Parameters<(typeof Notifications)["getNextTriggerDateAsync"]>[0]
    const permissions = { ios: { allowAlert: true } }
    const cases = [
      [Notifications.getBadgeCountAsync, notificationMocks.getBadgeCountAsync, []],
      [
        Notifications.setBadgeCountAsync(3, badgeOptions),
        notificationMocks.setBadgeCountAsync,
        [3, badgeOptions],
      ],
      [
        Notifications.getAllScheduledNotificationsAsync,
        notificationMocks.getAllScheduledNotificationsAsync,
        [],
      ],
      [
        Notifications.scheduleNotificationAsync(request),
        notificationMocks.scheduleNotificationAsync,
        [request],
      ],
      [
        Notifications.cancelScheduledNotificationAsync("scheduled"),
        notificationMocks.cancelScheduledNotificationAsync,
        ["scheduled"],
      ],
      [
        Notifications.cancelAllScheduledNotificationsAsync,
        notificationMocks.cancelAllScheduledNotificationsAsync,
        [],
      ],
      [
        Notifications.getNotificationCategoriesAsync,
        notificationMocks.getNotificationCategoriesAsync,
        [],
      ],
      [
        Notifications.setNotificationCategoryAsync("message", [action], categoryOptions),
        notificationMocks.setNotificationCategoryAsync,
        ["message", [action], categoryOptions],
      ],
      [
        Notifications.deleteNotificationCategoryAsync("message"),
        notificationMocks.deleteNotificationCategoryAsync,
        ["message"],
      ],
      [
        Notifications.getNextTriggerDateAsync(trigger),
        notificationMocks.getNextTriggerDateAsync,
        [trigger],
      ],
      [
        Notifications.requestPermissionsAsync(permissions),
        notificationMocks.requestPermissionsAsync,
        [permissions],
      ],
      [
        Notifications.setAutoServerRegistrationEnabledAsync(false),
        notificationMocks.setAutoServerRegistrationEnabledAsync,
        [false],
      ],
      [Notifications.registerTaskAsync("push"), notificationMocks.registerTaskAsync, ["push"]],
      [Notifications.unregisterTaskAsync("push"), notificationMocks.unregisterTaskAsync, ["push"]],
    ] as const

    for (const [effect, mock, args] of cases) {
      mock.mockResolvedValueOnce(result)
      await expect(run(effect as Effect.Effect<unknown, NotificationsError, never>)).resolves.toBe(
        result,
      )
      expect(mock).toHaveBeenLastCalledWith(...args)
    }
  })

  it("forwards synchronous and deprecated response operations", async () => {
    const response = { actionIdentifier: "open" }
    notificationMocks.getLastNotificationResponseAsync.mockResolvedValueOnce(response)
    notificationMocks.clearLastNotificationResponse.mockReturnValueOnce(undefined)

    await expect(run(Notifications.getLastNotificationResponseAsync)).resolves.toBe(response)
    await expect(run(Notifications.clearLastNotificationResponse)).resolves.toBeUndefined()
    expect(notificationMocks.getLastNotificationResponseAsync).toHaveBeenCalledWith()
    expect(notificationMocks.clearLastNotificationResponse).toHaveBeenCalledWith()
  })

  it("classifies unavailable and ordinary native failures", async () => {
    notificationMocks.getPermissionsAsync.mockRejectedValueOnce(
      Object.assign(new Error("unavailable"), { code: "ERR_UNAVAILABLE" }),
    )
    const unavailable = await Effect.runPromiseExit(
      Notifications.getPermissionsAsync.pipe(Effect.provide(Notifications.live)),
    )
    expect(unavailable._tag).toBe("Failure")
    if (unavailable._tag === "Failure") {
      const reason = unavailable.cause.reasons[0]
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(Notifications.NotificationsUnavailable)
        expect(reason.error.method).toBe("getPermissionsAsync")
      }
    }

    notificationMocks.scheduleNotificationAsync.mockRejectedValueOnce(new Error("native"))
    const failed = await Effect.runPromiseExit(
      Notifications.scheduleNotificationAsync({ content: {}, trigger: null }).pipe(
        Effect.provide(Notifications.live),
      ),
    )
    expect(failed._tag).toBe("Failure")
    if (failed._tag === "Failure") {
      const reason = failed.cause.reasons[0]
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(Notifications.NotificationsFailure)
        expect(reason.error.method).toBe("scheduleNotificationAsync")
      }
    }

    notificationMocks.clearLastNotificationResponse.mockImplementationOnce(() => {
      throw Object.assign(new Error("notifications unavailable"), {
        code: "ERR_NOTIFICATIONS_UNAVAILABLE",
      })
    })
    const syncUnavailable = await Effect.runPromiseExit(
      Notifications.clearLastNotificationResponse.pipe(Effect.provide(Notifications.live)),
    )
    expect(syncUnavailable._tag).toBe("Failure")
    if (syncUnavailable._tag === "Failure") {
      const reason = syncUnavailable.cause.reasons[0]
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(Notifications.NotificationsUnavailable)
        expect(reason.error.method).toBe("clearLastNotificationResponse")
      }
    }
  })

  it("owns each notification listener for exactly one stream scope", async () => {
    const remove = vi.fn()
    notificationMocks.addNotificationReceivedListener.mockImplementationOnce(
      (listener: (notification: unknown) => void) => {
        listener({ request: { identifier: "received" } })
        return { remove }
      },
    )
    const values = await Effect.runPromise(
      Notifications.addNotificationReceivedListener.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.provide(Notifications.live),
      ),
    )
    expect(Array.from(values)).toEqual([{ request: { identifier: "received" } }])
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("does not discard notification events when a synchronous burst exceeds sixteen items", async () => {
    const remove = vi.fn()
    notificationMocks.addNotificationReceivedListener.mockImplementationOnce(
      (listener: (notification: unknown) => void) => {
        for (let identifier = 0; identifier < 32; identifier += 1) {
          listener({ request: { identifier: String(identifier) } })
        }
        return { remove }
      },
    )

    const values = await Effect.runPromise(
      Notifications.addNotificationReceivedListener.pipe(
        Stream.take(32),
        Stream.runCollect,
        Effect.provide(Notifications.live),
      ),
    )

    expect(
      Array.from(
        values,
        (notification) =>
          (notification as { readonly request: { readonly identifier: string } }).request
            .identifier,
      ),
    ).toEqual(Array.from({ length: 32 }, (_, identifier) => String(identifier)))
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("reports synchronous listener acquisition failures through the typed channel", async () => {
    notificationMocks.addPushTokenListener.mockImplementationOnce(() => {
      throw Object.assign(new Error("unavailable"), { code: "ERR_UNAVAILABLE" })
    })
    const exit = await Effect.runPromiseExit(
      Notifications.addPushTokenListener.pipe(Stream.runHead, Effect.provide(Notifications.live)),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(Notifications.NotificationsUnavailable)
        expect(reason.error.method).toBe("addPushTokenListener")
      }
    }
  })

  it("adapts dropped, response, clear, and push listeners as scoped Streams", async () => {
    const removals = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    const response = { notification: { request: { identifier: "response" } } }
    const token = { type: "android", data: "token" }
    notificationMocks.addNotificationsDroppedListener.mockImplementationOnce(
      (listener: () => void) => {
        listener()
        return { remove: removals[0] }
      },
    )
    notificationMocks.addNotificationResponseReceivedListener.mockImplementationOnce(
      (listener: (value: typeof response) => void) => {
        listener(response)
        return { remove: removals[1] }
      },
    )
    notificationMocks.addNotificationResponseClearedListener.mockImplementationOnce(
      (listener: () => void) => {
        listener()
        return { remove: removals[2] }
      },
    )
    notificationMocks.addPushTokenListener.mockImplementationOnce(
      (listener: (value: typeof token) => void) => {
        listener(token)
        return { remove: removals[3] }
      },
    )

    const first = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
      Effect.runPromise(
        stream.pipe(
          Stream.take(1),
          Stream.runHead,
          Effect.provide(Notifications.live),
        ) as Effect.Effect<unknown>,
      )
    await expect(first(Notifications.addNotificationsDroppedListener)).resolves.toBeDefined()
    await expect(
      first(Notifications.addNotificationResponseReceivedListener),
    ).resolves.toBeDefined()
    await expect(first(Notifications.addNotificationResponseClearedListener)).resolves.toBeDefined()
    await expect(first(Notifications.addPushTokenListener)).resolves.toBeDefined()
    for (const remove of removals) expect(remove).toHaveBeenCalledTimes(1)
  })

  it("installs the foreground handler synchronously with a fresh child scope", async () => {
    const runtime = ManagedRuntime.make(Notifications.live)
    const released = vi.fn()
    Notifications.setNotificationHandler(runtime, {
      handleNotification: () =>
        Effect.acquireRelease(
          Effect.succeed({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: false,
            shouldSetBadge: false,
          }),
          () => Effect.sync(released),
        ),
    })
    expect(notificationMocks.setNotificationHandler).toHaveBeenCalledTimes(1)
    const handler = notificationMocks.setNotificationHandler.mock.calls[0]?.[0] as {
      handleNotification(notification: unknown): Promise<unknown>
    }
    await expect(handler.handleNotification({ request: {} })).resolves.toMatchObject({
      shouldShowBanner: true,
    })
    expect(released).toHaveBeenCalledTimes(1)
    await runtime.dispose()
  })

  it("preserves foreground success/error callbacks and clears the global handler", async () => {
    const runtime = ManagedRuntime.make(Notifications.live)
    const handleSuccess = vi.fn()
    const handleError = vi.fn()
    Notifications.setNotificationHandler(runtime, {
      handleNotification: () => Effect.die(new Error("handler failed")),
      handleSuccess,
      handleError,
    })
    const handler = notificationMocks.setNotificationHandler.mock.calls.at(-1)?.[0] as {
      handleNotification(notification: unknown): Promise<unknown>
      handleSuccess(notificationId: string): void
      handleError(notificationId: string, error: Error): void
    }
    await expect(handler.handleNotification({ request: {} })).rejects.toThrow("handler failed")
    handler.handleSuccess("success")
    handler.handleError("failure", new Error("native"))
    expect(handleSuccess).toHaveBeenCalledWith("success")
    expect(handleError).toHaveBeenCalledWith("failure", expect.any(Error))

    Notifications.setNotificationHandler(runtime, null)
    expect(notificationMocks.setNotificationHandler).toHaveBeenLastCalledWith(null)
    await runtime.dispose()
  })

  it("hydrates and orders response Atom events with identifier dedupe and joint cleanup", async () => {
    const initial = { notification: { request: { identifier: "initial" } } }
    const duplicate = { notification: { request: { identifier: "initial" } } }
    const next = { notification: { request: { identifier: "next" } } }
    let receive: ((response: typeof initial) => void) | undefined
    let clear: (() => void) | undefined
    const removeReceive = vi.fn()
    const removeClear = vi.fn()
    notificationMocks.getLastNotificationResponse.mockReturnValue(initial)
    notificationMocks.addNotificationResponseReceivedListener.mockImplementation(
      (listener: (response: typeof initial) => void) => {
        receive = listener
        return { remove: removeReceive }
      },
    )
    notificationMocks.addNotificationResponseClearedListener.mockImplementation(
      (listener: () => void) => {
        clear = listener
        return { remove: removeClear }
      },
    )

    const registry = AtomRegistry.make()
    const release = registry.mount(Notifications.lastNotificationResponseAtom)

    const value = () => {
      const result = registry.get(Notifications.lastNotificationResponseAtom)
      if (!AsyncResult.isSuccess(result)) throw new Error("expected response Atom value")
      return result.value
    }
    await vi.waitFor(() => expect(value()).toBe(initial))

    receive?.(duplicate)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(value()).toBe(initial)

    receive?.(next)
    clear?.()
    await vi.waitFor(() => expect(value()).toBeNull())

    release()
    await vi.waitFor(() => {
      expect(removeReceive).toHaveBeenCalledTimes(1)
      expect(removeClear).toHaveBeenCalledTimes(1)
    })
  })

  it("reports response Atom hydration and partial-listener acquisition failures", async () => {
    notificationMocks.getLastNotificationResponse.mockImplementationOnce(() => {
      throw Object.assign(new Error("unavailable"), { code: "ERR_UNAVAILABLE" })
    })
    const hydrationRegistry = AtomRegistry.make()
    const releaseHydration = hydrationRegistry.mount(Notifications.lastNotificationResponseAtom)
    await vi.waitFor(() => {
      expect(
        AsyncResult.isFailure(hydrationRegistry.get(Notifications.lastNotificationResponseAtom)),
      ).toBe(true)
    })
    releaseHydration()

    const removeReceive = vi.fn()
    notificationMocks.getLastNotificationResponse.mockReturnValueOnce(null)
    notificationMocks.addNotificationResponseReceivedListener.mockReturnValueOnce({
      remove: removeReceive,
    })
    notificationMocks.addNotificationResponseClearedListener.mockImplementationOnce(() => {
      throw new Error("clear listener failed")
    })
    const listenerRegistry = AtomRegistry.make()
    const releaseListener = listenerRegistry.mount(Notifications.lastNotificationResponseAtom)
    await vi.waitFor(() => {
      expect(
        AsyncResult.isFailure(listenerRegistry.get(Notifications.lastNotificationResponseAtom)),
      ).toBe(true)
      expect(removeReceive).toHaveBeenCalledTimes(1)
    })
    releaseListener()
  })

  it("maps background task failures and defects to Expo's Failed result", async () => {
    const runtime = ManagedRuntime.make(Notifications.live)
    const definition = NotificationBackground.defineBackgroundNotificationTask(
      "push",
      runtime,
      () => Effect.fail("failed"),
    )
    expect(definition.name).toBe("push")
    const executor = taskManagerMocks.defineTask.mock.calls[0]?.[1] as
      | ((body: unknown) => Promise<unknown>)
      | undefined
    await expect(executor?.({ data: { notification: null, data: {} } })).resolves.toBe(
      Notifications.BackgroundNotificationTaskResult.Failed,
    )
    await runtime.dispose()
  })

  it("returns successful background results and registers the proven task name", async () => {
    const runtime = ManagedRuntime.make(Notifications.live)
    const definition = NotificationBackground.defineBackgroundNotificationTask(
      "push-success",
      runtime,
      () => Effect.succeed(Notifications.BackgroundNotificationTaskResult.NewData),
    )
    const executor = taskManagerMocks.defineTask.mock.calls.at(-1)?.[1] as
      | ((body: unknown) => Promise<unknown>)
      | undefined
    await expect(executor?.({ data: { notification: null, data: {} } })).resolves.toBe(
      Notifications.BackgroundNotificationTaskResult.NewData,
    )

    notificationMocks.registerTaskAsync.mockResolvedValueOnce(null)
    await expect(run(NotificationBackground.registerBackgroundTask(definition))).resolves.toBeNull()
    expect(notificationMocks.registerTaskAsync).toHaveBeenCalledWith("push-success")
    await runtime.dispose()
  })
})
