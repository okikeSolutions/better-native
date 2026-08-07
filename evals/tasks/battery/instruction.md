# Battery

Implement `src/ObserveBattery.ts` using only the installed public `@better-native/battery` package
and normal `effect/*` entrypoints.

Export `batteryLevels`, an Effect `Stream` that:

- consumes `Battery.addBatteryLevelListener`;
- emits only each event's numeric `batteryLevel`;
- provides `Battery.live` at the application boundary; and
- preserves `BatteryFailure` in the stream error channel when native listener registration fails.

The stream must be resource-safe: stopping downstream consumption early must release the native
subscription. Do not construct a replacement stream from fixed values, call `expo-battery`
directly, or import better-native source files, package internals, or test doubles. Do not add files
or change the exported name.
