# @better-native/location

Effect-native location, geocoding, permissions, foreground observation, and persistent background
tracking for Expo SDK 57.

```sh
npx expo install expo-location @better-native/location@0.0.1-alpha.1 effect@4.0.0-beta.102
```

The reviewed provider range is Expo Location 57 (`>=57.0.0 <58.0.0`) with Effect
`4.0.0-beta.102`. For a split manual install, first run `npx expo install expo-location`, then use
one package-manager command:

```sh
npm install @better-native/location@0.0.1-alpha.1 effect@4.0.0-beta.102
pnpm add @better-native/location@0.0.1-alpha.1 effect@4.0.0-beta.102
yarn add @better-native/location@0.0.1-alpha.1 effect@4.0.0-beta.102
bun add @better-native/location@0.0.1-alpha.1 effect@4.0.0-beta.102
```

Provide `Location.live` for one-shot operations and consume foreground observations as scoped
Streams. Closing the Stream scope removes the native Expo subscription.
The Effect one-shot position, heading, and motion operations are implemented from those scoped
watchers so interruption removes the native subscription. They preserve Expo's options and value
selection, including the heading accuracy retry rule, while adding cancellation-safe cleanup.

```ts
import { Location } from "@better-native/location"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

const current = Location.getCurrentPositionAsync({
  accuracy: Location.Accuracy.Balanced,
}).pipe(Effect.provide(Location.live))

const firstThree = Location.watchPositionAsync({
  accuracy: Location.Accuracy.Balanced,
}).pipe(Stream.take(3), Stream.runCollect, Effect.provide(Location.live))
```

Permission hooks map to `foregroundPermissionAtom`, `backgroundPermissionAtom`, and
`motionActivityPermissionAtom`. Existing Expo call sites can migrate incrementally through
`@better-native/location/expo`; this preserves the complete pinned Expo surface.

Background location and geofencing are persistent Task Manager registrations, not Scope-owned
subscriptions. Define their handlers at module scope with `@better-native/task-manager`, keep its
`ManagedRuntime` alive for as long as the OS can launch the task, and stop registrations explicitly.
Do not define tasks from React components.

```sh
npx expo install expo-task-manager
npm install @better-native/task-manager@0.0.1-alpha.1
pnpm add @better-native/task-manager@0.0.1-alpha.1
yarn add @better-native/task-manager@0.0.1-alpha.1
bun add @better-native/task-manager@0.0.1-alpha.1
```

The `expo-location` config plugin remains available as `@better-native/location/app.plugin`. Keep it
enabled when using native permissions or background tracking:

```json
{
  "expo": {
    "plugins": [
      [
        "@better-native/location/app.plugin",
        {
          "locationWhenInUsePermission": "Allow this app to use your location.",
          "isIosBackgroundLocationEnabled": true,
          "isAndroidBackgroundLocationEnabled": true,
          "isAndroidForegroundServiceEnabled": true,
          "isAndroidMotionActivityEnabled": true,
          "androidForegroundServiceIcon": "./assets/location-service.png"
        }
      ]
    ]
  }
}
```

Enable only the capabilities your app uses; the background, foreground-service, and motion flags
default to `false`. The Android foreground-service icon must be a valid project-relative image.
The plugin configures iOS location usage
strings and background mode, plus Android foreground/background and motion permissions and the
foreground-service notification assets. Regenerate native projects after plugin changes; bare apps
must apply equivalent native configuration manually.

See the [Expo Location guide](https://docs.expo.dev/versions/latest/sdk/location/) for the complete
provider option and platform-permission matrix.

Web uses browser geolocation and permission APIs, returns empty geocoder results, and does not
support native heading, motion activity, background tracking, or geofencing. Expo Go also limits
background location. Use a development or production build, and validate permission transitions,
background delivery, process relaunch, and geofencing on physical devices before shipping.

Location failures use the typed `LocationFailure` channel. Operations absent on the current runtime
use `LocationUnavailable`. Permission denial remains a normal Expo permission response so callers
can render or branch on it explicitly.
