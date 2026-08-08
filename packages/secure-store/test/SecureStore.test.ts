import { describe, expect, it, vi } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: 1,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 2,
  ALWAYS: 3,
  ALWAYS_THIS_DEVICE_ONLY: 4,
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 5,
  WHEN_UNLOCKED: 6,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  canUseBiometricAuthentication: vi.fn(),
  deleteItemAsync: vi.fn(),
  getItem: vi.fn(),
  getItemAsync: vi.fn(),
  isAvailableAsync: vi.fn(),
  setItem: vi.fn(),
  setItemAsync: vi.fn(),
}))

const ExpoSecureStore = await import("expo-secure-store")
const { SecureStore, SecureStoreFailure, SecureStoreService } = await import("../src/index")

const provideLayer =
  <ROut, E2, RIn>(layer: Layer.Layer<ROut, E2, RIn>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | E2, RIn | Exclude<R, ROut>> =>
    Effect.scoped(
      Layer.build(layer).pipe(Effect.flatMap((context) => Effect.provide(effect, context))),
    )

describe("@better-native/secure-store", () => {
  it("supports a fake service layer", async () => {
    const values = new Map<string, string>()
    const TestStore = Layer.succeed(
      SecureStoreService,
      SecureStoreService.of({
        isAvailable: Effect.succeed(true),
        canUseBiometricAuthentication: Effect.succeed(false),
        deleteItem: (key) => Effect.sync(() => void values.delete(key)),
        getItem: (key) => Effect.sync(() => values.get(key) ?? null),
        getItemAsync: (key) => Effect.sync(() => values.get(key) ?? null),
        setItem: (key, value) => Effect.sync(() => void values.set(key, value)),
        setItemAsync: (key, value) => Effect.sync(() => void values.set(key, value)),
      }),
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* SecureStore.setItemAsync("token", "secret")
        const stored = yield* SecureStore.getItemAsync("token")
        yield* SecureStore.deleteItemAsync("token")
        const deleted = yield* SecureStore.getItemAsync("token")
        return { stored, deleted }
      }).pipe(provideLayer(TestStore)),
    )

    expect(result).toEqual({ stored: "secret", deleted: null })
  })

  it("delegates async operations and options to Expo", async () => {
    const options = { keychainService: "session", requireAuthentication: true }
    vi.mocked(ExpoSecureStore.setItemAsync).mockResolvedValueOnce(undefined)
    vi.mocked(ExpoSecureStore.getItemAsync).mockResolvedValueOnce("secret")
    vi.mocked(ExpoSecureStore.deleteItemAsync).mockResolvedValueOnce(undefined)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* SecureStore.setItemAsync("token", "secret", options)
        const value = yield* SecureStore.getItemAsync("token", options)
        yield* SecureStore.deleteItemAsync("token", options)
        return value
      }).pipe(provideLayer(SecureStore.live)),
    )

    expect(result).toBe("secret")
    expect(ExpoSecureStore.setItemAsync).toHaveBeenCalledWith("token", "secret", options)
    expect(ExpoSecureStore.getItemAsync).toHaveBeenCalledWith("token", options)
    expect(ExpoSecureStore.deleteItemAsync).toHaveBeenCalledWith("token", options)
  })

  it("defers synchronous Expo calls until Effect execution", async () => {
    const options = { keychainService: "synchronous-session", requireAuthentication: true }
    vi.mocked(ExpoSecureStore.getItem).mockReturnValueOnce("secret")
    vi.mocked(ExpoSecureStore.setItem).mockReturnValueOnce(undefined)

    const write = SecureStore.setItem("token", "secret", options).pipe(
      provideLayer(SecureStore.live),
    )
    const read = SecureStore.getItem("token", options).pipe(provideLayer(SecureStore.live))

    expect(ExpoSecureStore.setItem).not.toHaveBeenCalled()
    expect(ExpoSecureStore.getItem).not.toHaveBeenCalled()
    await Effect.runPromise(write)
    await expect(Effect.runPromise(read)).resolves.toBe("secret")
    expect(ExpoSecureStore.setItem).toHaveBeenCalledWith("token", "secret", options)
    expect(ExpoSecureStore.getItem).toHaveBeenCalledWith("token", options)
  })

  it("reads availability and biometric support", async () => {
    vi.mocked(ExpoSecureStore.isAvailableAsync).mockResolvedValueOnce(true)
    vi.mocked(ExpoSecureStore.canUseBiometricAuthentication).mockReturnValueOnce(true)

    const result = await Effect.runPromise(
      Effect.all({
        available: SecureStore.isAvailableAsync,
        biometric: SecureStore.canUseBiometricAuthentication,
      }).pipe(provideLayer(SecureStore.live)),
    )

    expect(result).toEqual({ available: true, biometric: true })
  })

  it("preserves a missing or invalidated item as null", async () => {
    vi.mocked(ExpoSecureStore.getItemAsync).mockResolvedValueOnce(null)

    await expect(
      Effect.runPromise(
        SecureStore.getItemAsync("missing-token").pipe(provideLayer(SecureStore.live)),
      ),
    ).resolves.toBeNull()
  })

  it.each([
    [
      "getItemAsync",
      () => {
        vi.mocked(ExpoSecureStore.getItemAsync).mockRejectedValueOnce(new Error("cancelled"))
        return SecureStore.getItemAsync("token")
      },
    ],
    [
      "getItem",
      () => {
        vi.mocked(ExpoSecureStore.getItem).mockImplementationOnce(() => {
          throw new Error("cancelled")
        })
        return SecureStore.getItem("token")
      },
    ],
    [
      "setItem",
      () => {
        vi.mocked(ExpoSecureStore.setItem).mockImplementationOnce(() => {
          throw new Error("invalid value")
        })
        return SecureStore.setItem("token", "secret")
      },
    ],
    [
      "setItemAsync",
      () => {
        vi.mocked(ExpoSecureStore.setItemAsync).mockRejectedValueOnce(new Error("invalid value"))
        return SecureStore.setItemAsync("token", "secret")
      },
    ],
  ] as const)("wraps %s failures with method and key context", async (method, operation) => {
    const exit = await Effect.runPromiseExit(operation().pipe(provideLayer(SecureStore.live)))

    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    const reason = exit.cause.reasons[0]
    if (
      reason === undefined ||
      !Cause.isFailReason(reason) ||
      !(reason.error instanceof SecureStoreFailure)
    ) {
      throw new Error("expected a SecureStoreFailure")
    }
    expect(reason.error.method).toBe(method)
    expect(reason.error.key).toBe("token")
    expect(reason.error.cause).toBeInstanceOf(Error)
  })

  it.each([
    [
      "isAvailableAsync",
      () => {
        const cause = new Error("native availability failure")
        vi.mocked(ExpoSecureStore.isAvailableAsync).mockRejectedValueOnce(cause)
        return { cause, operation: SecureStore.isAvailableAsync }
      },
    ],
    [
      "canUseBiometricAuthentication",
      () => {
        const cause = new Error("native biometric failure")
        vi.mocked(ExpoSecureStore.canUseBiometricAuthentication).mockImplementationOnce(() => {
          throw cause
        })
        return { cause, operation: SecureStore.canUseBiometricAuthentication }
      },
    ],
  ] as const)("retains %s failures from keyless capability checks", async (method, makeFailure) => {
    const { cause: nativeCause, operation } = makeFailure()
    const exit = await Effect.runPromiseExit(operation.pipe(provideLayer(SecureStore.live)))

    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    const reason = exit.cause.reasons.find(Cause.isFailReason)
    if (reason === undefined || !(reason.error instanceof SecureStoreFailure)) {
      throw new Error("expected a SecureStoreFailure")
    }
    expect(reason.error.method).toBe(method)
    expect(reason.error.key).toBeUndefined()
    expect(reason.error.cause).toBe(nativeCause)
  })

  it("retains deletion failures in the typed error channel", async () => {
    const nativeCause = new Error("native deletion failure")
    vi.mocked(ExpoSecureStore.deleteItemAsync).mockRejectedValueOnce(nativeCause)

    const exit = await Effect.runPromiseExit(
      SecureStore.deleteItemAsync("token").pipe(provideLayer(SecureStore.live)),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    const reason = exit.cause.reasons.find(Cause.isFailReason)
    if (reason === undefined || !(reason.error instanceof SecureStoreFailure)) {
      throw new Error("expected a SecureStoreFailure")
    }
    expect(reason.error.method).toBe("deleteItemAsync")
    expect(reason.error.key).toBe("token")
    expect(reason.error.cause).toBe(nativeCause)
  })
})
