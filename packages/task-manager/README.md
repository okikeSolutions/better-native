# @better-native/task-manager

Effect-native inspection and lifecycle APIs for `expo-task-manager`.

Define tasks at module scope with an explicit `ManagedRuntime`; background launches do not mount
React components and cannot run a deferred registration Effect.

```ts
import { TaskManager } from "@better-native/task-manager"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"

const runtime = ManagedRuntime.make(TaskManager.live)

TaskManager.defineTask("sync", runtime, ({ data, error }) => Effect.log({ data, error }))
```

Use `TaskManager.isTaskRegisteredAsync`, `getTaskOptionsAsync`, and unregister APIs through
`TaskManager.live`. `runtime` is an application-lifetime, headless-safe resource: keep it alive
while the OS may invoke the task and dispose it only at a deliberate shutdown boundary.

Install the SDK-compatible provider and the exact reviewed wrapper/Effect versions together:

```sh
npx expo install expo-task-manager @better-native/task-manager@0.0.1-alpha.1 effect@4.0.0-rc.108
# npm
npm install expo-task-manager@">=57.0.0 <58.0.0" @better-native/task-manager@0.0.1-alpha.1 effect@4.0.0-rc.108
# pnpm
pnpm add expo-task-manager@">=57.0.0 <58.0.0" @better-native/task-manager@0.0.1-alpha.1 effect@4.0.0-rc.108
# Yarn
yarn add expo-task-manager@">=57.0.0 <58.0.0" @better-native/task-manager@0.0.1-alpha.1 effect@4.0.0-rc.108
# Bun
bun add expo-task-manager@">=57.0.0 <58.0.0" @better-native/task-manager@0.0.1-alpha.1 effect@4.0.0-rc.108
```

Existing Expo source can remain unchanged through
`@better-native/task-manager/expo`, including its Android headless-registration import side effect.

Web always reports unavailable (`false`); Expo Go and iOS background execution have additional
limitations. Use a development or production build and preserve the `app.plugin` configuration so
iOS receives the required background-fetch configuration. Registrations persist across launches;
use the owning module's stop API or an explicit unregister call rather than a Scope finalizer.

For CNG, configure the preserved plugin and regenerate the native projects:

```json
{ "expo": { "plugins": ["@better-native/task-manager/app.plugin"] } }
```

Bare iOS projects must provide the equivalent `fetch` background mode and rebuild. See the
[Expo Task Manager guide](https://docs.expo.dev/versions/latest/sdk/task-manager/) for platform and
development-build restrictions.
