import { describe, expect, it, vi } from "vitest"

const plugin = vi.fn()
const expo = vi.hoisted(() => ({
  defineTask: vi.fn(),
  getRegisteredTasksAsync: vi.fn(),
  getTaskOptionsAsync: vi.fn(),
  isAvailableAsync: vi.fn(),
  isTaskDefined: vi.fn(),
  isTaskRegisteredAsync: vi.fn(),
  unregisterAllTasksAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
}))

vi.mock("expo-task-manager", () => expo)
vi.mock("expo-task-manager/app.plugin.js", () => ({ default: plugin }))

const ExpoCompat = await import("../src/Expo.ts")
const Plugin = await import("../src/Plugin.ts")

describe("@better-native/task-manager compatibility entrypoints", () => {
  it("re-exports every Task Manager runtime value without wrapping it", () => {
    expect(ExpoCompat.defineTask).toBe(expo.defineTask)
    expect(ExpoCompat.getRegisteredTasksAsync).toBe(expo.getRegisteredTasksAsync)
    expect(ExpoCompat.getTaskOptionsAsync).toBe(expo.getTaskOptionsAsync)
    expect(ExpoCompat.isAvailableAsync).toBe(expo.isAvailableAsync)
    expect(ExpoCompat.isTaskDefined).toBe(expo.isTaskDefined)
    expect(ExpoCompat.isTaskRegisteredAsync).toBe(expo.isTaskRegisteredAsync)
    expect(ExpoCompat.unregisterAllTasksAsync).toBe(expo.unregisterAllTasksAsync)
    expect(ExpoCompat.unregisterTaskAsync).toBe(expo.unregisterTaskAsync)
  })

  it("preserves the config-plugin default export shape", () => {
    expect(Plugin.default).toBe(plugin)
  })
})
