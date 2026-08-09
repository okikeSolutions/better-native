# Define and persist an Effect-native background task

Implement `src/ObserveTask.ts` using only the public Better Native packages and Effect. Create a
headless-safe `ManagedRuntime`, define `dx.eval.background` synchronously at module scope with
`BackgroundTask.defineTask`, and make the handler succeed with the received `data.value`. Export
`registration`, an Effect that calls the enhanced `BackgroundTask.register` with a 15-minute
minimum interval and provides both live layers. The result must preserve `registered` and
`restricted` as distinct outcomes. Do not import package internals or Expo directly, and do not
scope the persistent registration to an automatic unregister finalizer.
