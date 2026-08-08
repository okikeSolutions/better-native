import * as Effect from "effect/Effect"
import { SecureStore } from "@better-native/secure-store"

export const name = "SecureStore native failure capability"

interface JasmineApi {
  readonly describe: (name: string, spec: () => void) => void
  readonly it: (name: string, spec: () => Promise<void>) => void
}

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

export function test({ describe, it }: JasmineApi): void {
  describe(name, () => {
    it("preserves an iOS keychain entitlement failure", async () => {
      const key = "better.native.capability.missing.entitlement"
      // The Jasmine capability module is the application boundary for this selected native run.
      /* oxlint-disable effecttsgo/strict-effect-provide */
      const failure = await Effect.runPromise(
        SecureStore.setItemAsync(key, "native-failure", {
          accessGroup: "group.no.entitlement",
        }).pipe(Effect.flip, Effect.provide(SecureStore.live)),
      )
      /* oxlint-enable effecttsgo/strict-effect-provide */
      assert(
        failure instanceof SecureStore.SecureStoreFailure,
        "SecureStore did not retain the iOS native failure",
      )
      assert(failure.method === "setItemAsync", "SecureStore failure lost the native method")
      assert(failure.key === key, "SecureStore failure lost the key")
      assert(failure.cause instanceof Error, "SecureStore failure lost the native cause")
    })
  })
}
