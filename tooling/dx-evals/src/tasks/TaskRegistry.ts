import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type * as Domain from "../Domain.ts"
import * as Battery from "./Battery.ts"
import * as BackgroundTask from "./BackgroundTask.ts"
import * as KeepAwake from "./KeepAwake.ts"
import * as Location from "./Location.ts"
import * as Network from "./Network.ts"
import * as Notifications from "./Notifications.ts"
import * as SecureStore from "./SecureStore.ts"
import * as Sqlite from "./Sqlite.ts"
import * as TaskManager from "./TaskManager.ts"
import * as Synthetic from "./Synthetic.ts"
import * as Workspace from "./Workspace.ts"

/** One reviewed DX task revision available to the current harness. */
export type Task =
  | Synthetic.Task
  | Network.Task
  | Battery.Task
  | BackgroundTask.Task
  | KeepAwake.Task
  | Location.Task
  | Notifications.Task
  | SecureStore.Task
  | Sqlite.Task
  | TaskManager.Task

/** Stable IDs in the closed reviewed task registry. */
export const registeredTaskIds = [
  "synthetic-effect",
  "network",
  "battery",
  "background-task",
  "keep-awake",
  "location",
  "notifications",
  "secure-store",
  "sqlite",
  "task-manager",
].toSorted()

/** Loads one task from the closed reviewed task registry. */
export const loadTask = (taskId: Domain.TaskId) =>
  Match.value<string>(taskId).pipe(
    Match.when("synthetic-effect", () => Synthetic.load),
    Match.when("network", () => Network.load),
    Match.when("battery", () => Battery.load),
    Match.when("background-task", () => BackgroundTask.load),
    Match.when("keep-awake", () => KeepAwake.load),
    Match.when("location", () => Location.load),
    Match.when("notifications", () => Notifications.load),
    Match.when("secure-store", () => SecureStore.load),
    Match.when("sqlite", () => Sqlite.load),
    Match.when("task-manager", () => TaskManager.load),
    Match.orElse(() =>
      Effect.fail(new Workspace.TaskBundleInvalid({ reason: `unknown-task:${taskId}` })),
    ),
  )
