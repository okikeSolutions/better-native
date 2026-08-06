import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type * as Domain from "../Domain.ts"
import * as Battery from "./Battery.ts"
import * as Network from "./Network.ts"
import * as Synthetic from "./Synthetic.ts"
import * as Workspace from "./Workspace.ts"

/** One reviewed DX task revision available to the current harness. */
export type Task = Synthetic.Task | Network.Task | Battery.Task

/** Loads one task from the closed reviewed task registry. */
export const loadTask = (taskId: Domain.TaskId) =>
  Match.value<string>(taskId).pipe(
    Match.when("synthetic-effect", () => Synthetic.load),
    Match.when("network", () => Network.load),
    Match.when("battery", () => Battery.load),
    Match.orElse(() =>
      Effect.fail(new Workspace.TaskBundleInvalid({ reason: `unknown-task:${taskId}` })),
    ),
  )
