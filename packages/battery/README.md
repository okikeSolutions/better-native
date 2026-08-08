# @better-native/battery

Effect-native battery and power state with an Expo-compatible entrypoint.

The package has two public boundaries:

- `@better-native/battery` provides typed Effects, scoped Streams, Effect Atoms, and a replaceable
  service;
- `@better-native/battery/expo` preserves the `expo-battery` import surface for incremental
  migration.

See Expo's [Battery documentation](https://docs.expo.dev/versions/latest/sdk/battery/) for the
platform-specific availability, event cadence, and fallback values. This guide documents Better
Native integration, not a separate statement of Expo's native contract.

## Installation

This package is currently a private workspace prototype. Inside this repository, declare it with
Effect and Expo's native capability provider:

```json
{
  "dependencies": {
    "@better-native/battery": "workspace:*",
    "effect": "4.0.0-beta.102",
    "expo-battery": "57.0.1"
  }
}
```

Expo applications should use `npx expo install expo-battery` to select the version compatible with
their Expo SDK, then rebuild after changing native dependencies.

## Effect API

```ts
import { Battery } from "@better-native/battery"
import * as Effect from "effect/Effect"

const powerState = Battery.getPowerStateAsync.pipe(Effect.provide(Battery.live))
```

The root API includes availability, level, state, low-power-mode, Android battery-optimization, and
combined power-state reads. Native rejection and invalid combined state data fail with
`BatteryFailure`, retaining the method and original cause.

Expo uses sentinel values on some platforms: for example, an unknown battery level can be `-1`, an
iOS simulator reports the API as unavailable, and web may not emit battery events. These are
successful upstream values rather than Better Native failures.

## Streams and React

The exact-name listener counterparts are scoped Streams:

- `addBatteryLevelListener`
- `addBatteryStateListener`
- `addLowPowerModeListener`

Each removes its Expo subscription when the consuming Stream scope closes. The corresponding
`batteryLevelAtom`, `batteryStateAtom`, and `lowPowerModeAtom` values combine an initial read with
updates. `powerStateAtom` maintains the combined snapshot as individual native events arrive.

## Expo-compatible import

For a low-churn migration, change only the module specifier:

```ts
import { usePowerState } from "@better-native/battery/expo"
```

The `/expo` entrypoint delegates to `expo-battery` and retains its Promise, subscription, and hook
behavior. Import from the package root when opting into Effects, Streams, Atoms, and typed failures.

## Evidence boundary

The compatibility ownership ledger currently classifies Battery as `fallback`: candidate bundles
route through the Expo-compatible wrapper, but the package has not been promoted to Effect ownership.
Use `bun run coverage` to inspect exact API mappings and paired compatibility runs for platform
behavior evidence. Simulator evidence cannot establish physical-device battery level, charging, or
low-power events.
