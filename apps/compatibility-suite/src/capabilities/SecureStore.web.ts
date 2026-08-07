import { SecureStore, SecureStoreFailure } from "@better-native/secure-store"
import * as Effect from "effect/Effect"
import * as ExpoSecureStore from "expo-secure-store"

export const name = "SecureStore web capability"

interface JasmineApi {
  readonly describe: (name: string, spec: () => void) => void
  readonly it: (name: string, spec: () => Promise<void>) => void
}

const captureError = async (operation: () => unknown): Promise<unknown> => {
  try {
    await operation()
  } catch (cause) {
    return cause
  }
  throw new Error("Expected the Expo SecureStore web operation to fail")
}

const expectMappedFailure = async (
  method: string,
  key: string | undefined,
  operation: Effect.Effect<string | null | void, SecureStoreFailure, SecureStore.SecureStore>,
): Promise<void> => {
  const failure = await Effect.runPromise(
    // The Jasmine capability module is the application boundary for this selected web run.
    // oxlint-disable-next-line effecttsgo/strict-effect-provide
    operation.pipe(Effect.provide(SecureStore.live), Effect.flip),
  )
  if (!(failure instanceof SecureStoreFailure)) {
    throw new Error(`Expected ${method} to fail with SecureStoreFailure`)
  }
  if (failure.method !== method || failure.key !== key || !(failure.cause instanceof Error)) {
    throw new Error(`Unexpected ${method} failure metadata`)
  }
}

export function test({ describe, it }: JasmineApi): void {
  describe(name, () => {
    it("reports the actual Expo web implementation as unavailable", async () => {
      if ((await ExpoSecureStore.isAvailableAsync()) !== false) {
        throw new Error("Expo SecureStore unexpectedly reported web availability")
      }
      const available = await Effect.runPromise(
        // oxlint-disable-next-line effecttsgo/strict-effect-provide
        SecureStore.isAvailableAsync.pipe(Effect.provide(SecureStore.live)),
      )
      if (available !== false) {
        throw new Error("The Effect API did not preserve Expo's web availability result")
      }
    })

    it("maps unsupported asynchronous web operations to SecureStoreFailure", async () => {
      const key = "better-native-web"
      const operations = [
        {
          method: "getItemAsync",
          expo: () => ExpoSecureStore.getItemAsync(key),
          effect: SecureStore.getItemAsync(key),
        },
        {
          method: "setItemAsync",
          expo: () => ExpoSecureStore.setItemAsync(key, "secret"),
          effect: SecureStore.setItemAsync(key, "secret"),
        },
        {
          method: "deleteItemAsync",
          expo: () => ExpoSecureStore.deleteItemAsync(key),
          effect: SecureStore.deleteItemAsync(key),
        },
      ] as const

      for (const operation of operations) {
        const expoFailure = await captureError(operation.expo)
        if (!(expoFailure instanceof Error)) {
          throw new Error(`Expo ${operation.method} did not produce an Error on web`)
        }
        await expectMappedFailure(operation.method, key, operation.effect)
      }
    })

    it("maps unsupported synchronous web operations to SecureStoreFailure", async () => {
      const key = "better-native-web"
      const operations = [
        {
          method: "getItem",
          expo: () => ExpoSecureStore.getItem(key),
          effect: SecureStore.getItem(key),
        },
        {
          method: "setItem",
          expo: () => ExpoSecureStore.setItem(key, "secret"),
          effect: SecureStore.setItem(key, "secret"),
        },
      ] as const

      for (const operation of operations) {
        const expoFailure = await captureError(operation.expo)
        if (!(expoFailure instanceof Error)) {
          throw new Error(`Expo ${operation.method} did not produce an Error on web`)
        }
        await expectMappedFailure(operation.method, key, operation.effect)
      }
    })
  })
}
