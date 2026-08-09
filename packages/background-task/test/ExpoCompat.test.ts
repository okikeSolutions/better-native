import { describe, expect, it, vi } from "vitest"

const plugin = vi.fn()
const expo = vi.hoisted(() => ({
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  addExpirationListener: vi.fn(),
  getStatusAsync: vi.fn(),
  registerTaskAsync: vi.fn(),
  triggerTaskWorkerForTestingAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
}))

vi.mock("expo-background-task", () => expo)
vi.mock("expo-background-task/app.plugin.js", () => ({ default: plugin }))

const ExpoCompat = await import("../src/Expo.ts")
const Plugin = await import("../src/Plugin.ts")

describe("@better-native/background-task compatibility entrypoints", () => {
  it("re-exports every Background Task runtime value without wrapping it", () => {
    expect(ExpoCompat.BackgroundTaskStatus).toBe(expo.BackgroundTaskStatus)
    expect(ExpoCompat.BackgroundTaskResult).toBe(expo.BackgroundTaskResult)
    expect(ExpoCompat.addExpirationListener).toBe(expo.addExpirationListener)
    expect(ExpoCompat.getStatusAsync).toBe(expo.getStatusAsync)
    expect(ExpoCompat.registerTaskAsync).toBe(expo.registerTaskAsync)
    expect(ExpoCompat.triggerTaskWorkerForTestingAsync).toBe(expo.triggerTaskWorkerForTestingAsync)
    expect(ExpoCompat.unregisterTaskAsync).toBe(expo.unregisterTaskAsync)
  })

  it("preserves the config-plugin default export shape", () => {
    expect(Plugin.default).toBe(plugin)
  })
})
