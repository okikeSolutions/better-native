import { TaskManager } from "@better-native/task-manager"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as BackgroundFetch from "expo-background-fetch"
import * as ExpoTaskManager from "expo-task-manager"
import { Platform } from "react-native"

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
const registrationOptions = {
  minimumInterval: 15 * 60,
  stopOnTerminate: false,
  startOnBoot: true,
}

TaskManager.defineTask(taskName, runtime, ({ data }) => Effect.succeed(data))

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- compatibility capability entry point
  Effect.runPromise(effect.pipe(Effect.provide(TaskManager.live)) as Effect.Effect<A, E>)

export function test({ describe, it }: JasmineApi): void {
  describe(name, () => {
    it("defines an Effect task during cold bundle initialization", async () => {
      const defined = await run(TaskManager.isTaskDefined(taskName))
      assert(defined, "Effect task was not defined during bundle initialization")
      assert(
        ExpoTaskManager.isTaskDefined(taskName),
        "Expo did not observe the Effect task definition",
      )
    })

    it("agrees with Expo about platform availability", async () => {
      const effectAvailable = await run(TaskManager.isAvailableAsync)
      const expoAvailable = await ExpoTaskManager.isAvailableAsync()
      assert(typeof effectAvailable === "boolean", "Task Manager availability was not a boolean")
      assert(effectAvailable === expoAvailable, "Effect and Expo availability differed")
    })

    it("inspects and removes a persistent native registration", async () => {
      const available = await ExpoTaskManager.isAvailableAsync()
      if (!available) {
        assert(Platform.OS === "web", "Task Manager was unexpectedly unavailable on native")
        return
      }

      if (await ExpoTaskManager.isTaskRegisteredAsync(taskName)) {
        await BackgroundFetch.unregisterTaskAsync(taskName)
      }
      try {
        await BackgroundFetch.registerTaskAsync(taskName, registrationOptions)
        assert(
          await run(TaskManager.isTaskRegisteredAsync(taskName)),
          "Effect did not observe the persistent registration",
        )
        const options = await run(
          TaskManager.getTaskOptionsAsync<typeof registrationOptions>(taskName),
        )
        assert(options !== null, "Effect did not return persistent registration options")
        assert(
          options.minimumInterval === registrationOptions.minimumInterval,
          "Effect returned different registration options",
        )
        const tasks = await run(TaskManager.getRegisteredTasksAsync)
        assert(
          tasks.some((task) => task.taskName === taskName),
          "Effect did not list the persistent registration",
        )

        await run(TaskManager.unregisterTaskAsync(taskName))
        assert(
          !(await ExpoTaskManager.isTaskRegisteredAsync(taskName)),
          "Expo still observed the Effect-removed registration",
        )
      } finally {
        if (await ExpoTaskManager.isTaskRegisteredAsync(taskName)) {
          await BackgroundFetch.unregisterTaskAsync(taskName)
        }
      }
    })
  })
}
