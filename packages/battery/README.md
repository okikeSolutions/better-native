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

Install the native provider, this package, and its Effect peer in one Expo CLI transaction:

```sh
npx expo install expo-battery @better-native/battery@alpha effect@4.0.0-rc.108
```

Expo selects the `expo-battery` version compatible with the application's SDK. The Better Native
and Effect specifications remain explicit because Expo does not version those third-party
packages. Rebuild after changing native dependencies.

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

The compatibility ownership ledger classifies Battery as `effect`. Paired Release comparisons pass
the reviewed Effect reads, combined power state, Streams, and Atoms on iOS, Android, and web with
zero divergences. Expo remains the native capability provider behind `Battery.live`. Use
`bun run coverage` to inspect exact API mappings. Simulator and emulator evidence cannot establish
physical-device battery level, charging, or low-power events; those remain separate device evidence.
