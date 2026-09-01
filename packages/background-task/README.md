# @better-native/background-task

Effect-native persistent scheduling for Expo Background Task, composed with the module-scope
Task Manager runtime boundary.

Install both native providers and the two matching Better Native packages:

```sh
npx expo install expo-background-task expo-task-manager \
  @better-native/background-task@0.0.1-alpha.1 \
  @better-native/task-manager@0.0.1-alpha.1 \
  effect@4.0.0-rc.112
```

Manual equivalents use the reviewed provider range:

```sh
npm install expo-background-task@">=57.0.0 <58.0.0" expo-task-manager@">=57.0.0 <58.0.0" @better-native/background-task@0.0.1-alpha.1 @better-native/task-manager@0.0.1-alpha.1 effect@4.0.0-rc.112
pnpm add expo-background-task@">=57.0.0 <58.0.0" expo-task-manager@">=57.0.0 <58.0.0" @better-native/background-task@0.0.1-alpha.1 @better-native/task-manager@0.0.1-alpha.1 effect@4.0.0-rc.112
yarn add expo-background-task@">=57.0.0 <58.0.0" expo-task-manager@">=57.0.0 <58.0.0" @better-native/background-task@0.0.1-alpha.1 @better-native/task-manager@0.0.1-alpha.1 effect@4.0.0-rc.112
bun add expo-background-task@">=57.0.0 <58.0.0" expo-task-manager@">=57.0.0 <58.0.0" @better-native/background-task@0.0.1-alpha.1 @better-native/task-manager@0.0.1-alpha.1 effect@4.0.0-rc.112
```

Define the handler at module scope. Background launches do not mount React components.

```ts
import { BackgroundTask } from "@better-native/background-task"
import { TaskManager } from "@better-native/task-manager"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"

const AppLive = Layer.merge(TaskManager.live, BackgroundTask.live)
const runtime = ManagedRuntime.make(AppLive)

export const syncTask = BackgroundTask.defineTask("sync", runtime, () => Effect.log("syncing"))

export const registerSync = BackgroundTask.register(syncTask, {
  minimumInterval: 15,
}).pipe(Effect.provide(AppLive))
```

Keep the runtime alive for as long as the operating system may launch the app. The interval is an
inexact OS hint, not a cron expression or delivery guarantee. Registrations persist across launches
and are not automatically removed by an Effect Scope; unregister them explicitly when appropriate.
Android and iOS may share one native worker across tasks, so registrations are not independent
schedulers.

Web and Expo Go report `BackgroundTaskStatus.Restricted`. iOS Simulator also uses the restricted
no-op path. Genuine scheduling requires a development or production build and physical-device
evidence. The testing trigger works only in debug builds and returns `false` in production.

On iOS, keep the Expo config plugin enabled. It adds the `processing` background mode and
`com.expo.modules.backgroundtask.processing` scheduler identifier. CNG projects must regenerate
native projects; bare projects must integrate equivalent Info.plist configuration and rebuild.
Use `BackgroundTask.addExpirationListener` or `withExpiration` to checkpoint and interrupt work when
iOS expires an invocation, while assuming that process termination can still prevent finalizers.

```json
{ "expo": { "plugins": ["@better-native/background-task/app.plugin"] } }
```

See the [Expo Background Task guide](https://docs.expo.dev/versions/latest/sdk/background-task/)
for CNG, bare-project, and physical-device requirements.

Existing Expo imports can migrate incrementally through `@better-native/background-task/expo`.

Paired Release comparisons pass status agreement, persistent registration and cleanup through Task
Manager, and production trigger behavior on web, iOS Simulator, and Android API 36 with zero
divergences. Paired CNG produces matching native fingerprints. Compatibility ownership remains
`fallback` until a physical device proves scheduled and cold-launch handler delivery; simulator
registration evidence must not be read as scheduled execution evidence.
