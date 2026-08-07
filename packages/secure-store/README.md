# @better-native/secure-store

Effect-native encrypted key-value storage with an Expo-compatible entrypoint.

`@better-native/secure-store` exposes typed Effects and a replaceable service. The
`@better-native/secure-store/expo` entrypoint preserves the `expo-secure-store` runtime and type
surface for incremental migration.

## Installation

This package is currently a private workspace prototype. Declare it alongside Effect and Expo's
native capability provider:

```json
{
  "dependencies": {
    "@better-native/secure-store": "workspace:*",
    "effect": "4.0.0-beta.102",
    "expo-secure-store": "57.0.1"
  }
}
```

Expo applications should resolve the native module with `npx expo install expo-secure-store` and
rebuild the native application after installation. See Expo's
[SecureStore documentation](https://docs.expo.dev/versions/latest/sdk/securestore/) for config-plugin,
Face ID permission, Android backup, and export-compliance configuration.

The versions above describe this repository's current Expo 57 toolchain, not a compatibility range
for every Expo application. In particular, biometric authentication is not fully available in Expo
Go because the required Face ID usage description is absent; use a configured development or release
build for that behavior.

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

The Expo-compatible surface remains upstream-owned while candidate routing exercises this wrapper.
Unit and compile checks establish host-side type, delegation, and error-channel contracts; paired
iOS and Android compatibility evidence is still required before promoting the package to Effect
ownership.
