import * as Effect from "effect/Effect"
import { SecureStore } from "@better-native/secure-store"
import * as ExpoSecureStore from "expo-secure-store"

export const name = "SecureStore Effect capability"

interface JasmineApi {
  readonly describe: (name: string, spec: () => void) => void
  readonly it: (name: string, spec: () => Promise<void>) => void
}

const run = <A, E>(effect: Effect.Effect<A, E, SecureStore.SecureStore>) =>
  // The Jasmine capability module is the application boundary for this independently selected run.
  // oxlint-disable-next-line effecttsgo/strict-effect-provide
  Effect.runPromise(effect.pipe(Effect.provide(SecureStore.live)))

const cleanup = (key: string, options?: SecureStore.SecureStoreOptions): Promise<void> =>
  run(SecureStore.deleteItemAsync(key, options)).catch(() => undefined)

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

export function test({ describe, it }: JasmineApi): void {
  describe(name, () => {
    it("reports availability and biometric capability through the live layer", async () => {
      const expoAvailable = await ExpoSecureStore.isAvailableAsync()
      const expoBiometric = ExpoSecureStore.canUseBiometricAuthentication()
      const result = await run(
        Effect.all({
          available: SecureStore.isAvailableAsync,
          biometric: SecureStore.canUseBiometricAuthentication,
        }),
      )
      assert(typeof result.available === "boolean", "SecureStore availability was not boolean")
      assert(result.available, "SecureStore is unavailable on this native platform")
      assert(typeof result.biometric === "boolean", "SecureStore biometric support was not boolean")
      assert(result.available === expoAvailable, "Effect and Expo availability results differ")
      assert(result.biometric === expoBiometric, "Effect and Expo biometric results differ")
    })

    it("round trips and deletes an asynchronous value with options", async () => {
      const key = "better.native.capability.async"
      const value = "async-secret"
      const options = { keychainService: "better-native-capability-async" }
      await cleanup(key, options)
      try {
        const result = await run(
          Effect.gen(function* () {
            yield* SecureStore.setItemAsync(key, value, options)
            const stored = yield* SecureStore.getItemAsync(key, options)
            yield* SecureStore.deleteItemAsync(key, options)
            const deleted = yield* SecureStore.getItemAsync(key, options)
            return { stored, deleted }
          }),
        )
        assert(result.stored === value, "SecureStore did not return the asynchronous value")
        assert(result.deleted === null, "SecureStore did not return null after deletion")
      } finally {
        await cleanup(key, options)
      }
    })

    it("round trips synchronously and observes asynchronous deletion", async () => {
      const key = "better.native.capability.sync"
      const value = "sync-secret"
      const options = { keychainService: "better-native-capability-sync" }
      await cleanup(key, options)
      try {
        const result = await run(
          Effect.gen(function* () {
            yield* SecureStore.setItem(key, value, options)
            const stored = yield* SecureStore.getItem(key, options)
            yield* SecureStore.deleteItemAsync(key, options)
            const deleted = yield* SecureStore.getItem(key, options)
            return { stored, deleted }
          }),
        )
        assert(result.stored === value, "SecureStore did not return the synchronous value")
        assert(result.deleted === null, "SecureStore synchronous read was not null after deletion")
      } finally {
        await cleanup(key, options)
      }
    })

    it("keeps values isolated by keychain service", async () => {
      const key = "better.native.capability.options"
      const first = { keychainService: "better-native-capability-first" }
      const second = { keychainService: "better-native-capability-second" }
      await Promise.all([cleanup(key, first), cleanup(key, second)])
      try {
        const result = await run(
          Effect.gen(function* () {
            yield* SecureStore.setItemAsync(key, "isolated-secret", first)
            return yield* SecureStore.getItemAsync(key, second)
          }),
        )
        assert(result === null, "SecureStore returned a value from a different keychain service")
      } finally {
        await Promise.all([cleanup(key, first), cleanup(key, second)])
      }
    })

    it("preserves validation failures in the typed error channel", async () => {
      const failure = await run(SecureStore.setItemAsync("", "invalid-key").pipe(Effect.flip))
      assert(
        failure instanceof SecureStore.SecureStoreFailure,
        "SecureStore did not retain the typed failure",
      )
      assert(failure.method === "setItemAsync", "SecureStore failure lost the native method")
      assert(failure.key === "", "SecureStore failure lost the invalid key")
      assert(failure.cause instanceof Error, "SecureStore failure lost its original cause")
    })
  })
}
