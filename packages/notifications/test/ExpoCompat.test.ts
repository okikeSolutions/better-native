import { describe, expect, it, vi } from "vitest"

const plugin = vi.hoisted(() => vi.fn())
const expo = vi.hoisted(() => ({
  AndroidAudioContentType: {},
  AndroidAudioUsage: {},
  AndroidImportance: {},
  AndroidNotificationPriority: {},
  AndroidNotificationVisibility: {},
  BackgroundNotificationTaskResult: {},
  DEFAULT_ACTION_IDENTIFIER: "default",
  IosAlertStyle: {},
  IosAllowsPreviews: {},
  IosAuthorizationStatus: {},
  NotificationTimeoutError: class NotificationTimeoutError extends Error {},
  PermissionStatus: {},
  SchedulableTriggerInputTypes: {},
  addNotificationReceivedListener: vi.fn(),
  addNotificationResponseClearedListener: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(),
  addNotificationsDroppedListener: vi.fn(),
  addPushTokenListener: vi.fn(),
  cancelAllScheduledNotificationsAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  clearLastNotificationResponse: vi.fn(),
  clearLastNotificationResponseAsync: vi.fn(),
  deleteNotificationCategoryAsync: vi.fn(),
  deleteNotificationChannelAsync: vi.fn(),
  deleteNotificationChannelGroupAsync: vi.fn(),
  dismissAllNotificationsAsync: vi.fn(),
  dismissNotificationAsync: vi.fn(),
  getAllScheduledNotificationsAsync: vi.fn(),
  getBadgeCountAsync: vi.fn(),
  getDevicePushTokenAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  getLastNotificationResponse: vi.fn(),
  getLastNotificationResponseAsync: vi.fn(),
  getNextTriggerDateAsync: vi.fn(),
  getNotificationCategoriesAsync: vi.fn(),
  getNotificationChannelAsync: vi.fn(),
  getNotificationChannelGroupAsync: vi.fn(),
  getNotificationChannelGroupsAsync: vi.fn(),
  getNotificationChannelsAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  getPresentedNotificationsAsync: vi.fn(),
  registerTaskAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  setAutoServerRegistrationEnabledAsync: vi.fn(),
  setBadgeCountAsync: vi.fn(),
  setNotificationCategoryAsync: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  setNotificationChannelGroupAsync: vi.fn(),
  setNotificationHandler: vi.fn(),
  subscribeToTopicAsync: vi.fn(),
  unregisterForNotificationsAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
  unsubscribeFromTopicAsync: vi.fn(),
  useLastNotificationResponse: vi.fn(),
}))

vi.mock("expo-notifications", () => expo)
vi.mock("expo-notifications/app.plugin.js", () => ({ default: plugin }))

const ExpoCompat = await import("../src/Expo.ts")
const Plugin = await import("../src/Plugin.ts")
const Root = await import("../src/index.ts")

describe("@better-native/notifications compatibility entrypoints", () => {
  it("re-exports every Expo Notifications runtime value by identity", () => {
    expect(Object.keys(ExpoCompat).sort()).toEqual(Object.keys(expo).sort())
    for (const name of Object.keys(expo) as Array<keyof typeof expo>) {
      expect(ExpoCompat[name]).toBe(expo[name])
    }
  })

  it("preserves the config-plugin default export", () => {
    expect(Plugin.default).toBe(plugin)
  })

  it("normalizes the nested CommonJS config-plugin default shape", async () => {
    const commonJsPlugin = vi.fn()
    vi.resetModules()
    vi.doMock("expo-notifications/app.plugin.js", () => ({
      default: { default: commonJsPlugin },
    }))

    const CommonJsPlugin = await import("../src/Plugin.ts")
    expect(CommonJsPlugin.default).toBe(commonJsPlugin)
    vi.doUnmock("expo-notifications/app.plugin.js")
  })

  it("exposes the Effect module through both root import styles", () => {
    expect(Root.Notifications.live).toBe(Root.live)
    expect(Root.Notifications.scheduleNotificationAsync).toBe(Root.scheduleNotificationAsync)
  })
})
