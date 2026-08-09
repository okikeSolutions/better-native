# @better-native/notifications

Effect-native access to Expo Notifications, including typed failures, scoped event Streams, a
last-response Atom, and explicit module-scope foreground/background handler boundaries.

## Install

Let Expo choose the SDK-compatible Notifications provider while installing the exact Better Native
and Effect versions:

```sh
npx expo install expo-notifications @better-native/notifications@0.0.1-alpha.1 effect@4.0.0-beta.102
```

For a split manual install, first run `npx expo install expo-notifications`, then choose one package
manager command:

```sh
npm install @better-native/notifications@0.0.1-alpha.1 effect@4.0.0-beta.102
pnpm add @better-native/notifications@0.0.1-alpha.1 effect@4.0.0-beta.102
yarn add @better-native/notifications@0.0.1-alpha.1 effect@4.0.0-beta.102
bun add @better-native/notifications@0.0.1-alpha.1 effect@4.0.0-beta.102
```

Background delivery additionally requires Task Manager. Install its Expo provider, then choose one
package manager command for its Better Native package:

```sh
npx expo install expo-task-manager
npm install @better-native/task-manager@0.0.1-alpha.1
pnpm add @better-native/task-manager@0.0.1-alpha.1
yarn add @better-native/task-manager@0.0.1-alpha.1
bun add @better-native/task-manager@0.0.1-alpha.1
```

This release supports `expo-notifications >=57.0.0 <58.0.0` and Effect `4.0.0-beta.102`.

## Effect API

```ts
import { Notifications } from "@better-native/notifications"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

const program = Effect.gen(function* () {
  const permission = yield* Notifications.getPermissionsAsync
  const scheduled = yield* Notifications.scheduleNotificationAsync({
    content: { title: "Sync finished" },
    trigger: null,
  })
  yield* Effect.log({ permission, scheduled })
  yield* Notifications.addNotificationReceivedListener.pipe(
    Stream.runForEach((notification) => Effect.log(notification.request.identifier)),
  )
}).pipe(Effect.provide(Notifications.live))
```

Each Stream subscription owns and removes its Expo listener. React applications can consume
`lastNotificationResponseAtom` with `@effect/atom-react`; its `AsyncResult.Initial` state represents
Expo's initial `undefined`. It then hydrates the native response, follows response/clear events in
delivery order, and releases both listeners.

## Foreground and background handlers

Handlers must be installed at module scope, before React mounts. They are deliberately synchronous
initialization functions rather than lazy Effects.

```ts
import { Notifications } from "@better-native/notifications"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"

const runtime = ManagedRuntime.make(Notifications.live)

Notifications.setNotificationHandler(runtime, {
  handleNotification: () =>
    Effect.succeed({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
})
```

For background push handling, build a process-lifetime runtime that includes both Notifications and
Task Manager, import the helpers from `@better-native/notifications/background`, call
`defineBackgroundNotificationTask` in a module imported by the app entrypoint, then persistently
register its returned definition with `registerBackgroundTask`. Do not define it
inside a component. Background delivery is best effort: the operating system may delay or skip it,
and killed-app delivery requires a development/production build and a correctly configured push
payload. Dispose the runtime only at a deliberate application shutdown boundary.

```ts
import { Notifications } from "@better-native/notifications"
import {
  defineBackgroundNotificationTask,
  registerBackgroundTask,
} from "@better-native/notifications/background"
import { TaskManager } from "@better-native/task-manager"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"

const AppLive = Layer.merge(Notifications.live, TaskManager.live)
const runtime = ManagedRuntime.make(AppLive)

const backgroundNotification = defineBackgroundNotificationTask(
  "background-notification",
  runtime,
  (payload) =>
    Effect.log(payload).pipe(Effect.as(Notifications.BackgroundNotificationTaskResult.NewData)),
)

void runtime.runPromise(registerBackgroundTask(backgroundNotification))
```

## Expo compatibility and native configuration

Existing Expo code can migrate without API changes by importing from
`@better-native/notifications/expo`. That entrypoint preserves Expo's import-time device-token
auto-registration behavior. The Effect root also imports Expo and is therefore intentionally
side-effectful.

Add the plugin to app configuration and rebuild native projects:

```json
{
  "expo": {
    "plugins": [
      [
        "@better-native/notifications/app.plugin",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#ffffff",
          "defaultChannel": "default",
          "enableBackgroundRemoteNotifications": true,
          "sounds": ["./assets/notification.wav"]
        }
      ]
    ]
  }
}
```

CNG projects should regenerate and rebuild after plugin changes. Bare projects must apply the
equivalent Android notification resources/defaults and iOS push entitlement/background remote
notification mode themselves. Push tokens and remote delivery require a physical device and valid
APNs/FCM credentials; Expo Go does not provide the full remote-notification contract. Web support
depends on the browser and several native-only operations fail through `NotificationsUnavailable`.
See the [Expo Notifications guide](https://docs.expo.dev/versions/latest/sdk/notifications/) for
provider credentials and platform restrictions.

Package ownership remains `fallback` until paired Release and physical-device evidence has been
reviewed. The exact Expo bridge remains available during incremental migration.
