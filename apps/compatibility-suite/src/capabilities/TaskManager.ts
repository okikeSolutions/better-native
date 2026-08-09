import { TaskManager } from "@better-native/task-manager"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"

export const name = "Task Manager Effect capability"

interface JasmineApi {
  readonly describe: (name: string, spec: () => void) => void
  readonly it: (name: string, spec: () => Promise<void>) => void
}

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

/** This intentionally runs while the app bundle initializes, before any route mounts. */
const runtime = ManagedRuntime.make(TaskManager.live)
const taskName = "better-native-task-manager-capability"

TaskManager.defineTask(taskName, runtime, ({ data }) => Effect.succeed(data))

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- compatibility capability entry point
  Effect.runPromise(effect.pipe(Effect.provide(TaskManager.live)) as Effect.Effect<A, E>)

export function test({ describe, it }: JasmineApi): void {
  describe(name, () => {
    it("defines an Effect task during module initialization", async () => {
      const defined = await run(TaskManager.isTaskDefined(taskName))
      assert(defined, "Effect task was not defined during bundle initialization")
    })

    it("reports the platform's Task Manager availability through the live layer", async () => {
      const available = await run(TaskManager.isAvailableAsync)
      assert(typeof available === "boolean", "Task Manager availability was not a boolean")
    })
  })
}
