import { describe, expect, it, vi } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type {
  SecureStore as SecureStoreTag,
  SecureStoreFailure as SecureStoreFailureType,
} from "../src/SecureStore.ts"

const native = vi.hoisted(() => ({
  deleteValueWithKeyAsync: vi.fn(),
  getValueWithKeyAsync: vi.fn(),
  getValueWithKeySync: vi.fn(),
  setValueWithKeyAsync: vi.fn(),
  setValueWithKeySync: vi.fn(),
}))

vi.mock("expo-modules-core", () => ({
  requireNativeModule: vi.fn(() => ({
    AFTER_FIRST_UNLOCK: 1,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 2,
    ALWAYS: 3,
    ALWAYS_THIS_DEVICE_ONLY: 4,
    WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 5,
    WHEN_UNLOCKED: 6,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
    canUseBiometricAuthentication: vi.fn(() => true),
    ...native,
  })),
}))

const { SecureStore, SecureStoreFailure } = await import("../src/index")

const provideLayer =
  <ROut, E2, RIn>(layer: Layer.Layer<ROut, E2, RIn>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | E2, RIn | Exclude<R, ROut>> =>
    Effect.scoped(
      Layer.build(layer).pipe(Effect.flatMap((context) => Effect.provide(effect, context))),
    )

const failureFrom = async (
  effect: Effect.Effect<unknown, SecureStoreFailureType, SecureStoreTag>,
) => {
  const exit = await Effect.runPromiseExit(effect.pipe(provideLayer(SecureStore.live)))
  expect(exit._tag).toBe("Failure")
  if (exit._tag !== "Failure") throw new Error("expected operation to fail")
  const reason = exit.cause.reasons.find(Cause.isFailReason)
  if (reason === undefined || !(reason.error instanceof SecureStoreFailure)) {
    throw new Error("expected a SecureStoreFailure")
  }
  return reason.error
}

describe("Expo SecureStore validation boundary", () => {
  it("maps Expo's actual invalid-key validation without reaching the native module", async () => {
    const failure = await failureFrom(SecureStore.getItemAsync("invalid key"))

    expect(failure.method).toBe("getItemAsync")
    expect(failure.key).toBe("invalid key")
    expect(failure.cause).toBeInstanceOf(Error)
    expect(String(failure.cause)).toContain("Invalid key provided to SecureStore")
    expect(native.getValueWithKeyAsync).not.toHaveBeenCalled()
  })

  it("maps Expo's actual invalid-value validation without reaching the native module", async () => {
    const failure = await failureFrom(SecureStore.setItem("token", null as unknown as string))

    expect(failure.method).toBe("setItem")
    expect(failure.key).toBe("token")
    expect(failure.cause).toBeInstanceOf(Error)
    expect(String(failure.cause)).toContain("Invalid value provided to SecureStore")
    expect(native.setValueWithKeySync).not.toHaveBeenCalled()
  })
})
