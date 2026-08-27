# @better-native/secure-store

Effect-native encrypted key-value storage with an Expo-compatible entrypoint.

`@better-native/secure-store` exposes typed Effects and a replaceable service. The
`@better-native/secure-store/expo` entrypoint preserves the `expo-secure-store` runtime and type
surface for incremental migration.

## Installation

Install the native provider, this package, and its Effect peer in one Expo CLI transaction:

```sh
npx expo install expo-secure-store @better-native/secure-store@alpha effect@4.0.0-rc.112
```

Expo selects the `expo-secure-store` version compatible with the application's SDK. The Better
Native and Effect specifications remain explicit because Expo does not version those third-party
packages. Rebuild the native application after installation when its provider or configuration
changed. See Expo's
[SecureStore documentation](https://docs.expo.dev/versions/latest/sdk/securestore/) for config-plugin,
Face ID permission, Android backup, and export-compliance configuration.

Biometric authentication is not fully available in Expo Go because the required Face ID usage
description is absent; use a configured development or release build for that behavior.

## Effect API

```ts
import { SecureStore } from "@better-native/secure-store"
import * as Effect from "effect/Effect"

const session = Effect.gen(function* () {
  yield* SecureStore.setItemAsync("session.token", "secret")
  return yield* SecureStore.getItemAsync("session.token")
}).pipe(Effect.provide(SecureStore.live))
```

Failures retain the Expo or native error as the `cause` of a `SecureStoreFailure`, together with the
method and key. This includes invalid input and biometric cancellation. A missing or invalidated
item remains a successful `null`, matching Expo.

The exact-name `getItem` and `setItem` functions defer Expo's synchronous calls until their Effects
run, but they can still block the JavaScript thread during biometric authentication. Prefer the
async variants for application work.

`deleteItemAsync`, `isAvailableAsync`, and `canUseBiometricAuthentication` are Effects as well. Pass
the same `keychainService` option when reading or deleting a value written under a custom service.

## Expo-compatible import

For a low-churn migration, change only the module specifier:

```ts
import * as SecureStore from "@better-native/secure-store/expo"
```

This boundary preserves Expo's synchronous and Promise-based behavior. The root entrypoint returns
Effects instead.

## Platform support

The native capability is available on Android and iOS. On web, `isAvailableAsync` follows Expo and
resolves to `false`; attempted storage operations follow Expo's unsupported behavior and the Effect
API maps thrown or rejected operations to `SecureStoreFailure`. Authentication-protected values
require the native configuration described in Expo's documentation and biometric behavior must be
verified on a real device.

## Persistence and security boundaries

SecureStore is intended for small secrets such as tokens and keys, not irreplaceable primary data.
The underlying platforms can reject large strings, so applications must handle `SecureStoreFailure`
rather than treating storage as an unbounded database.
Android values do not survive uninstall. iOS Keychain values can persist across reinstall, but that
behavior is not guaranteed. Values protected with `requireAuthentication` can become inaccessible
when biometric enrollment changes.

The compatibility ownership ledger classifies SecureStore as `effect`. Paired Release comparisons
pass the reviewed Effect boundary on iOS and Android, the actual unsupported web behavior, and a
genuine iOS Keychain entitlement rejection with zero divergences. Expo remains the native
capability provider behind `SecureStore.live`. Unit and compile checks separately establish the
host-side type, delegation, and error-channel contracts. Biometric success and cancellation still
require separately recorded physical-device evidence because they are interactive and depend on
enrolled device state.
