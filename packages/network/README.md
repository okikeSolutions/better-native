# @better-native/network

Effect-native network state with an Expo-compatible entrypoint.

The package has two public boundaries:

- `@better-native/network` provides typed Effects, a scoped Stream, an Effect Atom, and a
  replaceable service;
- `@better-native/network/expo` preserves the `expo-network` import surface for incremental
  migration.

See Expo's [Network documentation](https://docs.expo.dev/versions/latest/sdk/network/) for native
platform behavior and permissions. This guide covers the Better Native boundary; API mapping and
host tests alone are not native-parity evidence.

## Installation

This package is currently a private workspace prototype. Inside this repository, declare it with
Effect and Expo's native capability provider:

```json
{
  "dependencies": {
    "@better-native/network": "workspace:*",
    "effect": "4.0.0-beta.102",
    "expo-network": "57.0.1"
  }
}
```

Expo applications should resolve the native dependency with `npx expo install expo-network` and
rebuild the native application after changing native dependencies. Expo automatically adds the
Android network- and Wi-Fi-state permissions required by the module.

## Effect API

```ts
import { Network } from "@better-native/network"
import * as Effect from "effect/Effect"

const currentState = Network.getNetworkStateAsync.pipe(Effect.provide(Network.live))
```

The live layer validates the state returned by Expo. An unavailable native operation fails with
`NetworkUnavailable`; native rejection or invalid state data fails with `NetworkFailure`, retaining
the method and original cause.

`getIpAddressAsync` and `isAirplaneModeEnabledAsync` use the same error channel. Airplane-mode
inspection is an Android-only Expo capability, so consumers must handle unavailability rather than
assuming it works on every platform.

## Changes and React

`addNetworkStateListener` is a `Stream`. Its native subscription is removed when the Stream scope
closes:

```ts
import { Network } from "@better-native/network"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

const firstChange = Network.addNetworkStateListener.pipe(
  Stream.take(1),
  Stream.runCollect,
  Effect.provide(Network.live),
)
```

`networkStateAtom` combines the initial read with subsequent events for React consumers using
`@effect/atom-react`. It exposes Effect's asynchronous result state instead of hiding native or
decoding failures.

## Expo-compatible import

For a low-churn migration, change only the module specifier:

```ts
import { useNetworkState } from "@better-native/network/expo"
```

The `/expo` entrypoint delegates to `expo-network` and retains its Promise, callback, and hook
behavior. Import from the package root when opting into Effects, Streams, and typed failures.

## Evidence boundary

The compatibility ownership ledger currently classifies Network as `fallback`: candidate bundles
route through the Expo-compatible wrapper, but the package has not been promoted to Effect ownership.
Use `bun run coverage` to inspect exact API mappings and paired compatibility runs for platform
behavior evidence.
