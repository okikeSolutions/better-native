import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import type * as Scope from "effect/Scope"
import * as ExpoTaskManager from "expo-task-manager"

/**
 * Error delivered in an Expo task body.
 *
 * @category models
 * @since 0.0.0
 */
export type TaskManagerError = ExpoTaskManager.TaskManagerError

/**
 * Extra execution details delivered in an Expo task body.
 *
 * @category models
 * @since 0.0.0
 */
export type TaskManagerTaskBodyExecutionInfo = ExpoTaskManager.TaskManagerTaskBodyExecutionInfo

/**
 * Task body delivered by Expo when the operating system invokes a registered task.
 *
 * @category models
 * @since 0.0.0
 */
export type TaskManagerTaskBody<T = unknown> = ExpoTaskManager.TaskManagerTaskBody<T>

/**
 * Alias used by the Effect-native task-definition API.
 *
 * @category models
 * @since 0.0.0
 */
export type TaskBody<T = unknown> = TaskManagerTaskBody<T>

/**
 * Persisted task metadata returned by Expo.
 *
 * @category models
 * @since 0.0.0
 */
export type TaskManagerTask = ExpoTaskManager.TaskManagerTask

/**
 * Persisted task metadata retained for Expo source compatibility.
 *
 * @deprecated Use {@link TaskManagerTask} instead.
 * @category models
 * @since 0.0.0
 */
export type RegisteredTask = ExpoTaskManager.RegisteredTask

/**
 * Exact Expo task executor shape, retained for source-compatible migration through `/expo`.
 *
 * @category models
 * @since 0.0.0
 */
export type TaskManagerTaskExecutor<T = unknown> = ExpoTaskManager.TaskManagerTaskExecutor<T>

declare const TaskDefinitionTypeId: unique symbol

/**
 * Opaque proof that a task was synchronously defined through a supplied Effect runtime.
 *
 * Persistent scheduling packages can require this token so a task name cannot accidentally drift
 * from its module-scope handler definition.
 *
 * @category models
 * @since 0.0.0
 */
export interface TaskDefinition {
  readonly name: string
  readonly [TaskDefinitionTypeId]: typeof TaskDefinitionTypeId
}

/**
 * Typed native failure for Task Manager operations.
 *
 * @category errors
 * @since 0.0.0
 */
export class TaskManagerFailure extends Data.TaggedError("TaskManagerFailure")<{
  readonly method: string
  readonly cause: unknown
}> {}

/**
 * Typed failure for APIs unavailable on the current platform.
 *
 * @category errors
 * @since 0.0.0
 */
export class TaskManagerUnavailable extends Data.TaggedError("TaskManagerUnavailable")<{
  readonly method: string
  readonly cause: unknown
}> {}

/**
 * Effect-native service for persistent Task Manager inspection and removal operations.
 *
 * Registrations are durable native state. Do not acquire one in a Scope expecting automatic
 * cleanup: use the owning Expo module's stop API or an explicit unregister operation.
 *
 * @category services
 * @since 0.0.0
 */
export interface Service {
  readonly isDefined: (name: string) => Effect.Effect<boolean>
  readonly isAvailable: Effect.Effect<boolean, TaskManagerUnavailable | TaskManagerFailure>
  readonly isRegistered: (
    name: string,
  ) => Effect.Effect<boolean, TaskManagerUnavailable | TaskManagerFailure>
  readonly getOptions: <Options>(
    name: string,
  ) => Effect.Effect<Options | null, TaskManagerUnavailable | TaskManagerFailure>
  readonly registeredTasks: Effect.Effect<
    ReadonlyArray<RegisteredTask>,
    TaskManagerUnavailable | TaskManagerFailure
  >
  readonly unregister: (
    name: string,
  ) => Effect.Effect<void, TaskManagerUnavailable | TaskManagerFailure>
  readonly unregisterAll: Effect.Effect<void, TaskManagerUnavailable | TaskManagerFailure>
}

/**
 * Context tag for the Task Manager service.
 *
 * @category services
 * @since 0.0.0
 */
export class TaskManager extends Context.Service<TaskManager, Service>()(
  "@better-native/task-manager/TaskManager",
) {}

const isUnavailable = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ERR_UNAVAILABLE"
const native = <A>(method: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      isUnavailable(cause)
        ? new TaskManagerUnavailable({ method, cause })
        : new TaskManagerFailure({ method, cause }),
  })

/**
 * Checks whether Task Manager can run on this platform; web availability is normally `false`.
 *
 * @category operations
 * @since 0.0.0
 */
export const isAvailableAsync = Effect.flatMap(TaskManager, (service) => service.isAvailable)
/**
 * Checks whether a task was synchronously defined during bundle initialization.
 *
 * @category operations
 * @since 0.0.0
 */
export const isTaskDefined = (name: string) =>
  Effect.flatMap(TaskManager, (service) => service.isDefined(name))
/**
 * Checks whether a durable task registration exists.
 *
 * @category operations
 * @since 0.0.0
 */
export const isTaskRegisteredAsync = (name: string) =>
  Effect.flatMap(TaskManager, (service) => service.isRegistered(name))
/**
 * Reads registered task options, returning `null` when Expo has no registration.
 *
 * @category operations
 * @since 0.0.0
 */
export const getTaskOptionsAsync = <Options>(name: string) =>
  Effect.flatMap(TaskManager, (service) => service.getOptions<Options>(name))
/**
 * Lists persistent task registrations.
 *
 * @category operations
 * @since 0.0.0
 */
export const getRegisteredTasksAsync = Effect.flatMap(
  TaskManager,
  (service) => service.registeredTasks,
)
/**
 * Removes one task registration. Prefer the owning Expo module's stop API where one exists.
 *
 * @category operations
 * @since 0.0.0
 */
export const unregisterTaskAsync = (name: string) =>
  Effect.flatMap(TaskManager, (service) => service.unregister(name))
/**
 * Removes every Task Manager registration.
 *
 * @category operations
 * @since 0.0.0
 */
export const unregisterAllTasksAsync = Effect.flatMap(
  TaskManager,
  (service) => service.unregisterAll,
)

/**
 * Defines an Effect handler synchronously at bundle initialization time.
 *
 * Do not call from a component or an Effect: headless launches require this registration before
 * React mounts. The supplied runtime owns dependencies used by the handler. Keep that runtime
 * alive for as long as the operating system can launch this bundle, and dispose it only at a
 * deliberate application shutdown boundary. Each invocation receives a fresh child Scope.
 *
 * @example
 * ```ts
 * import { TaskManager } from "@better-native/task-manager"
 * import * as Effect from "effect/Effect"
 * import * as ManagedRuntime from "effect/ManagedRuntime"
 *
 * const runtime = ManagedRuntime.make(TaskManager.live)
 *
 * TaskManager.defineTask("sync", runtime, ({ data }) =>
 *   Effect.log({ data }),
 * )
 * ```
 *
 * @category initialization
 * @since 0.0.0
 */
export const defineTask = <Data, A, E, R, ER>(
  name: string,
  runtime: ManagedRuntime.ManagedRuntime<R, ER>,
  handler: (body: TaskBody<Data>) => Effect.Effect<A, E, R | Scope.Scope>,
): TaskDefinition => {
  if (name.trim().length === 0) {
    throw new TypeError("Task Manager definitions require a non-empty task name")
  }
  ExpoTaskManager.defineTask(name, (body) =>
    runtime.runPromise(Effect.scoped(handler(body as TaskBody<Data>))),
  )
  return Object.freeze({ name }) as TaskDefinition
}

/**
 * Live Task Manager service backed by Expo's native module.
 *
 * @category layers
 * @since 0.0.0
 */
export const live = Layer.succeed(
  TaskManager,
  TaskManager.of({
    isDefined: (name) => Effect.sync(() => ExpoTaskManager.isTaskDefined(name)),
    isAvailable: native("isAvailableAsync", ExpoTaskManager.isAvailableAsync),
    isRegistered: (name) =>
      native("isTaskRegisteredAsync", () => ExpoTaskManager.isTaskRegisteredAsync(name)),
    getOptions: (name) =>
      native("getTaskOptionsAsync", () => ExpoTaskManager.getTaskOptionsAsync(name)),
    registeredTasks: native("getRegisteredTasksAsync", ExpoTaskManager.getRegisteredTasksAsync),
    unregister: (name) =>
      native("unregisterTaskAsync", () => ExpoTaskManager.unregisterTaskAsync(name)),
    unregisterAll: native("unregisterAllTasksAsync", ExpoTaskManager.unregisterAllTasksAsync),
  }),
)
