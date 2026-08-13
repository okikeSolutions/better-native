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

Install the native provider, this package, and its Effect peer in one Expo CLI transaction:

```sh
npx expo install expo-network @better-native/network@alpha effect@4.0.0-rc.108
```

Expo selects the `expo-network` version compatible with the application's SDK. The Better Native
and Effect specifications remain explicit because Expo does not version those third-party
packages. Rebuild the native application after changing native dependencies. Expo automatically
adds the Android network- and Wi-Fi-state permissions required by the module.

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

The compatibility ownership ledger classifies Network as `effect`. Paired Release comparisons pass
the reviewed Effect reads, typed native unavailability, Stream lifecycle, and Atom hydration on iOS,
Android, and web with zero divergences. Expo remains the native capability provider behind
`Network.live`. Use `bun run coverage` to inspect exact API mappings.
