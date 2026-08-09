import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { TaskManager, type TaskBody, type TaskDefinition } from "@better-native/task-manager"
import * as ExpoBackgroundTask from "expo-background-task"

/**
 * Expo's inexact background-task scheduling options.
 *
 * `minimumInterval` is an operating-system hint, not a deadline or cron schedule.
 *
 * @category models
 * @since 0.0.0
 */
export type BackgroundTaskOptions = ExpoBackgroundTask.BackgroundTaskOptions

/**
 * Alias retained for the Effect-native helpers.
 *
 * @category models
 * @since 0.0.0
 */
export type Options = BackgroundTaskOptions

/**
 * Native background-task availability status.
 *
 * @category models
 * @since 0.0.0
 */
export const BackgroundTaskStatus = ExpoBackgroundTask.BackgroundTaskStatus

/**
 * Native background-task availability status type.
 *
 * @category models
 * @since 0.0.0
 */
export type BackgroundTaskStatus = ExpoBackgroundTask.BackgroundTaskStatus

/**
 * Alias retained for concise Effect-native programs.
 *
 * @category models
 * @since 0.0.0
 */
export const Status = BackgroundTaskStatus

/**
 * Result returned to the operating system by a completed background handler.
 *
 * @category models
 * @since 0.0.0
 */
export const BackgroundTaskResult = ExpoBackgroundTask.BackgroundTaskResult

/**
 * Background handler result type.
 *
 * @category models
 * @since 0.0.0
 */
export type BackgroundTaskResult = ExpoBackgroundTask.BackgroundTaskResult

/**
 * Alias retained for concise Effect-native programs.
 *
 * @category models
 * @since 0.0.0
 */
export const Result = BackgroundTaskResult

/**
 * Observable outcome of the enhanced persistent registration operation.
 *
 * @category models
 * @since 0.0.0
 */
export type RegistrationOutcome = "registered" | "alreadyRegistered" | "restricted"

/**
 * Typed failure from the Expo BackgroundTask native module.
 *
 * @category errors
 * @since 0.0.0
 */
export class BackgroundTaskFailure extends Data.TaggedError("BackgroundTaskFailure")<{
  readonly method: string
  readonly cause: unknown
}> {}

/**
 * Typed failure when a native-only BackgroundTask method is unavailable.
 *
 * @category errors
 * @since 0.0.0
 */
export class BackgroundTaskUnavailable extends Data.TaggedError("BackgroundTaskUnavailable")<{
  readonly method: string
  readonly cause: unknown
}> {}

/**
 * Effect-native BackgroundTask service.
 *
 * Registrations are persistent native state and deliberately are not Scope finalizers.
 *
 * @category services
 * @since 0.0.0
 */
export interface Service {
  readonly status: Effect.Effect<
    ExpoBackgroundTask.BackgroundTaskStatus,
    BackgroundTaskUnavailable | BackgroundTaskFailure
  >
  readonly register: (
    name: string,
    options?: BackgroundTaskOptions,
  ) => Effect.Effect<void, BackgroundTaskUnavailable | BackgroundTaskFailure>
  readonly unregister: (
    name: string,
  ) => Effect.Effect<void, BackgroundTaskUnavailable | BackgroundTaskFailure>
  readonly triggerForTesting: Effect.Effect<
    boolean,
    BackgroundTaskUnavailable | BackgroundTaskFailure
  >
  readonly expirations: Stream.Stream<void, BackgroundTaskUnavailable | BackgroundTaskFailure>
}

/**
 * Context tag for BackgroundTask operations.
 *
 * @category services
 * @since 0.0.0
 */
export class BackgroundTask extends Context.Service<BackgroundTask, Service>()(
  "@better-native/background-task/BackgroundTask",
) {}

const unavailable = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ERR_UNAVAILABLE"
const native = <A>(method: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      unavailable(cause)
        ? new BackgroundTaskUnavailable({ method, cause })
        : new BackgroundTaskFailure({ method, cause }),
  })

/**
 * Reads the platform background-task availability status; web reports `Restricted`.
 *
 * @category operations
 * @since 0.0.0
 */
export const getStatusAsync = Effect.flatMap(BackgroundTask, (service) => service.status)
/**
 * Schedules a pre-defined global Task Manager task with an inexact minimum interval.
 *
 * This exact-name wrapper preserves Expo's `void` result, including restricted and already-
 * registered no-ops. Prefer {@link register} when the outcome matters.
 *
 * @category operations
 * @since 0.0.0
 */
export const registerTaskAsync = (name: string, options?: BackgroundTaskOptions) =>
  Effect.flatMap(BackgroundTask, (service) => service.register(name, options))
/**
 * Removes one BackgroundTask schedule without removing its Task Manager definition.
 *
 * @category operations
 * @since 0.0.0
 */
export const unregisterTaskAsync = (name: string) =>
  Effect.flatMap(BackgroundTask, (service) => service.unregister(name))
/**
 * Triggers the native worker in debug builds only; production Expo behavior is `false`.
 *
 * @category operations
 * @since 0.0.0
 */
export const triggerTaskWorkerForTestingAsync = Effect.flatMap(
  BackgroundTask,
  (service) => service.triggerForTesting,
)
const expirations = Stream.callback<void, BackgroundTaskUnavailable | BackgroundTaskFailure>(
  (queue) =>
    Effect.acquireRelease(
      Effect.try({
        try: () =>
          ExpoBackgroundTask.addExpirationListener(() => Queue.offerUnsafe(queue, undefined)),
        catch: (cause) =>
          unavailable(cause)
            ? new BackgroundTaskUnavailable({ method: "addExpirationListener", cause })
            : new BackgroundTaskFailure({ method: "addExpirationListener", cause }),
      }).pipe(Effect.tapError((error) => Queue.fail(queue, error))),
      (subscription) => Effect.sync(() => subscription.remove()),
    ),
)

/**
 * Stream of iOS background execution expiration events.
 *
 * Every subscription owns and removes its native listener through the surrounding Scope.
 *
 * @category streams
 * @since 0.0.0
 */
export const addExpirationListener = Stream.unwrap(
  Effect.map(BackgroundTask, (service) => service.expirations),
)

/**
 * Alias for {@link addExpirationListener}.
 *
 * @category streams
 * @since 0.0.0
 */
export const expirationEvents = addExpirationListener

/**
 * Runs an Effect until it completes or iOS reports that background execution expired.
 *
 * Finalizers are requested through interruption, but applications must still checkpoint work
 * because the operating system may terminate the process before cleanup finishes.
 *
 * @category lifecycle
 * @since 0.0.0
 */
export const withExpiration = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.raceFirst(
    effect,
    Stream.runHead(addExpirationListener).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.never,
          onSome: () => Effect.interrupt,
        }),
      ),
    ),
  )

/**
 * Defines an Effect background handler synchronously at module scope.
 *
 * Successful handlers report `Success`; typed failures, defects, and interruption are logged and
 * reported as `Failed`. The returned token is accepted by {@link register}.
 *
 * @example
 * ```ts
 * import { BackgroundTask } from "@better-native/background-task"
 * import * as Effect from "effect/Effect"
 * import * as Layer from "effect/Layer"
 * import * as ManagedRuntime from "effect/ManagedRuntime"
 *
 * const runtime = ManagedRuntime.make(Layer.empty)
 * const definition = BackgroundTask.defineTask("sync", runtime, () => Effect.void)
 *
 * console.log(definition.name)
 * ```
 *
 * @category initialization
 * @since 0.0.0
 */
export const defineTask = <Data, A, E, R, ER>(
  name: string,
  runtime: ManagedRuntime.ManagedRuntime<R, ER>,
  handler: (body: TaskBody<Data>) => Effect.Effect<A, E, R | Scope.Scope>,
): TaskDefinition =>
  TaskManager.defineTask(name, runtime, (body) =>
    handler(body as TaskBody<Data>).pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          Effect.logError("Background task failed", { cause, taskName: name }).pipe(
            Effect.as(BackgroundTaskResult.Failed),
          ),
        onSuccess: () => Effect.succeed(BackgroundTaskResult.Success),
      }),
    ),
  )

/**
 * Persistently registers a proven module-scope task definition.
 *
 * The result distinguishes a real native registration from Expo's two successful no-op states.
 * It does not promise independent timing: platforms may share one worker and control execution.
 *
 * @category operations
 * @since 0.0.0
 */
export const register = (definition: TaskDefinition, options?: BackgroundTaskOptions) =>
  Effect.gen(function* () {
    const status = yield* getStatusAsync
    if (status === BackgroundTaskStatus.Restricted) return "restricted" as const
    if (yield* TaskManager.isTaskRegisteredAsync(definition.name)) {
      return "alreadyRegistered" as const
    }
    yield* registerTaskAsync(definition.name, options)
    return "registered" as const
  })

/**
 * Live service backed by Expo BackgroundTask.
 *
 * @category layers
 * @since 0.0.0
 */
export const live = Layer.succeed(
  BackgroundTask,
  BackgroundTask.of({
    status: native("getStatusAsync", ExpoBackgroundTask.getStatusAsync),
    register: (name, options) =>
      native("registerTaskAsync", () => ExpoBackgroundTask.registerTaskAsync(name, options)),
    unregister: (name) =>
      native("unregisterTaskAsync", () => ExpoBackgroundTask.unregisterTaskAsync(name)),
    triggerForTesting: native(
      "triggerTaskWorkerForTestingAsync",
      ExpoBackgroundTask.triggerTaskWorkerForTestingAsync,
    ),
    expirations,
  }),
)
