import { BackgroundTask } from "@better-native/background-task"
import { TaskManager } from "@better-native/task-manager"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as ExpoBackgroundTask from "expo-background-task"
import * as ExpoTaskManager from "expo-task-manager"

export const name = "Background Task Effect capability"

interface JasmineApi {
  readonly describe: (name: string, spec: () => void) => void
  readonly it: (name: string, spec: () => Promise<void>) => void
}

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const AppLive = Layer.merge(TaskManager.live, BackgroundTask.live)
const runtime = ManagedRuntime.make(AppLive)
const taskName = "better-native-background-task-capability"

/** Eager by design: the operating system may launch this bundle without mounting a route. */
const definition = BackgroundTask.defineTask(taskName, runtime, () => Effect.void)

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- compatibility capability entry point
  Effect.runPromise(effect.pipe(Effect.provide(AppLive)) as Effect.Effect<A, E>)

export function test({ describe, it }: JasmineApi): void {
  describe(name, () => {
    it("defines the handler before inspecting native availability", async () => {
      assert(
        ExpoBackgroundTask.BackgroundTaskStatus.Restricted ===
          BackgroundTask.BackgroundTaskStatus.Restricted,
        "Background task Expo bridge did not preserve the status enum",
      )
      const defined = await run(TaskManager.isTaskDefined(taskName))
      assert(defined, "Background task was not defined during bundle initialization")
      const status = await run(BackgroundTask.getStatusAsync)
      const expoStatus = await ExpoBackgroundTask.getStatusAsync()
      assert(
        status === BackgroundTask.BackgroundTaskStatus.Available ||
          status === BackgroundTask.BackgroundTaskStatus.Restricted,
        "Background task returned an unknown availability status",
      )
      assert(status === expoStatus, "Effect and Expo background task status differed")
    })

    it("distinguishes restricted registration and cleans up native schedules", async () => {
      const outcome = await run(BackgroundTask.register(definition, { minimumInterval: 15 }))
      if (outcome === "restricted") {
        assert(
          (await ExpoBackgroundTask.getStatusAsync()) ===
            ExpoBackgroundTask.BackgroundTaskStatus.Restricted,
          "Effect restricted registration disagreed with Expo status",
        )
        return
      }

      assert(
        outcome === "registered" || outcome === "alreadyRegistered",
        "Background task returned an unknown registration outcome",
      )
      assert(
        await run(TaskManager.isTaskRegisteredAsync(taskName)),
        "Background task was not persisted through Task Manager",
      )
      assert(
        await ExpoTaskManager.isTaskRegisteredAsync(taskName),
        "Expo did not observe the Effect background registration",
      )
      const options = await ExpoTaskManager.getTaskOptionsAsync<{
        readonly minimumInterval: number
      }>(taskName)
      assert(options.minimumInterval === 15, "Expo observed different registration options")
      await run(BackgroundTask.unregisterTaskAsync(taskName))
      assert(
        !(await ExpoTaskManager.isTaskRegisteredAsync(taskName)),
        "Background task registration was not removed",
      )
    })

    it("preserves the production-disabled testing trigger", async () => {
      const triggered = await run(BackgroundTask.triggerTaskWorkerForTestingAsync)
      const expoTriggered = await ExpoBackgroundTask.triggerTaskWorkerForTestingAsync()
      assert(typeof triggered === "boolean", "Background task testing trigger was not boolean")
      assert(triggered === expoTriggered, "Effect and Expo testing trigger behavior differed")
      if (!__DEV__) assert(!triggered, "Production background task trigger must return false")
    })
  })
}
