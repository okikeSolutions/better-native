import { describe, expect, it, vi } from "vitest"

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: 1,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 2,
  ALWAYS: 3,
  ALWAYS_THIS_DEVICE_ONLY: 4,
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 5,
  WHEN_UNLOCKED: 6,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  canUseBiometricAuthentication: vi.fn(() => true),
  deleteItemAsync: vi.fn(async () => undefined),
  getItem: vi.fn(() => "sync"),
  getItemAsync: vi.fn(async () => "async"),
  isAvailableAsync: vi.fn(async () => true),
  setItem: vi.fn(() => undefined),
  setItemAsync: vi.fn(async () => undefined),
}))

const ExpoSecureStore = await import("expo-secure-store")
const Compat = await import("../src/Expo")

describe("@better-native/secure-store/expo", () => {
  it("preserves Expo runtime exports by identity", () => {
    for (const name of Object.keys(ExpoSecureStore)) {
      expect(Reflect.get(Compat, name), name).toBe(Reflect.get(ExpoSecureStore, name))
    }
  })

  it("retains Expo's synchronous and Promise return shapes", async () => {
    expect(Compat.getItem("token")).toBe("sync")
    expect(Compat.setItem("token", "secret")).toBeUndefined()
    await expect(Compat.getItemAsync("token")).resolves.toBe("async")
    await expect(Compat.setItemAsync("token", "secret")).resolves.toBeUndefined()
  })
})
