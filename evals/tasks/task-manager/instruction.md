# Define an Effect-native Expo task

Implement `src/ObserveTask.ts`. Define the task named `dx.eval.task` at module scope with the
public `@better-native/task-manager` API and an explicit `ManagedRuntime`. Its handler must return
the received `data.value`. Export `defined`, an Effect that uses `TaskManager.live` to verify that
the same task is defined. Do not import package internals or Expo directly.
