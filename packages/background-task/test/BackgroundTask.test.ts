import { beforeEach, describe, expect, it, vi } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"

/* oxlint-disable effecttsgo/strict-effect-provide -- test runtime entry points */

const backgroundMocks = vi.hoisted(() => ({
  getStatusAsync: vi.fn(),
  registerTaskAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
  triggerTaskWorkerForTestingAsync: vi.fn(),
  addExpirationListener: vi.fn(),
}))
const taskManagerMocks = vi.hoisted(() => ({
  defineTask: vi.fn(),
  isAvailableAsync: vi.fn(),
  isTaskDefined: vi.fn(),
  isTaskRegisteredAsync: vi.fn(),
  getTaskOptionsAsync: vi.fn(),
  getRegisteredTasksAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
  unregisterAllTasksAsync: vi.fn(),
}))

vi.mock("expo-background-task", () => ({
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  ...backgroundMocks,
}))
vi.mock("expo-task-manager", () => taskManagerMocks)

const BackgroundTask = await import("../src/BackgroundTask.ts")
const { TaskManager } = await import("@better-native/task-manager")

const BackgroundLive = BackgroundTask.live
const AppLive = Layer.merge(BackgroundLive, TaskManager.live)
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(BackgroundLive)) as Effect.Effect<A, E>)
const runApp = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(AppLive)) as Effect.Effect<A, E>)

describe("@better-native/background-task", () => {
  beforeEach(() => vi.clearAllMocks())

  it("forwards status, registration, unregistration, and the debug trigger", async () => {
    backgroundMocks.getStatusAsync.mockResolvedValueOnce(
      BackgroundTask.BackgroundTaskStatus.Available,
    )
    backgroundMocks.registerTaskAsync.mockResolvedValueOnce(undefined)
    backgroundMocks.unregisterTaskAsync.mockResolvedValueOnce(undefined)
    backgroundMocks.triggerTaskWorkerForTestingAsync.mockResolvedValueOnce(false)

    await expect(run(BackgroundTask.getStatusAsync)).resolves.toBe(
      BackgroundTask.BackgroundTaskStatus.Available,
    )
    await expect(
      run(BackgroundTask.registerTaskAsync("sync", { minimumInterval: 15 })),
    ).resolves.toBeUndefined()
    expect(backgroundMocks.registerTaskAsync).toHaveBeenCalledWith("sync", {
      minimumInterval: 15,
    })
    await expect(run(BackgroundTask.unregisterTaskAsync("sync"))).resolves.toBeUndefined()
    await expect(run(BackgroundTask.triggerTaskWorkerForTestingAsync)).resolves.toBe(false)
  })

  it("classifies unavailable and ordinary native failures", async () => {
    backgroundMocks.getStatusAsync.mockRejectedValueOnce(
      Object.assign(new Error("unavailable"), { code: "ERR_UNAVAILABLE" }),
    )
    const unavailableExit = await Effect.runPromiseExit(
      BackgroundTask.getStatusAsync.pipe(Effect.provide(BackgroundLive)),
    )
    expect(unavailableExit._tag).toBe("Failure")
    if (unavailableExit._tag === "Failure") {
      const reason = unavailableExit.cause.reasons[0]
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(BackgroundTask.BackgroundTaskUnavailable)
        expect(reason.error.method).toBe("getStatusAsync")
      }
    }

    backgroundMocks.unregisterTaskAsync.mockRejectedValueOnce(new Error("native failure"))
    const failureExit = await Effect.runPromiseExit(
      BackgroundTask.unregisterTaskAsync("sync").pipe(Effect.provide(BackgroundLive)),
    )
    expect(failureExit._tag).toBe("Failure")
    if (failureExit._tag === "Failure") {
      const reason = failureExit.cause.reasons[0]
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(BackgroundTask.BackgroundTaskFailure)
        expect(reason.error.method).toBe("unregisterTaskAsync")
      }
    }
  })

  it("distinguishes restricted, existing, and newly registered schedules", async () => {
    const definition = { name: "sync" } as import("@better-native/task-manager").TaskDefinition

    backgroundMocks.getStatusAsync.mockResolvedValueOnce(
      BackgroundTask.BackgroundTaskStatus.Restricted,
    )
    await expect(runApp(BackgroundTask.register(definition))).resolves.toBe("restricted")
    expect(backgroundMocks.registerTaskAsync).not.toHaveBeenCalled()

    backgroundMocks.getStatusAsync.mockResolvedValueOnce(
      BackgroundTask.BackgroundTaskStatus.Available,
    )
    taskManagerMocks.isTaskRegisteredAsync.mockResolvedValueOnce(true)
    await expect(runApp(BackgroundTask.register(definition))).resolves.toBe("alreadyRegistered")

    backgroundMocks.getStatusAsync.mockResolvedValueOnce(
      BackgroundTask.BackgroundTaskStatus.Available,
    )
    taskManagerMocks.isTaskRegisteredAsync.mockResolvedValueOnce(false)
    backgroundMocks.registerTaskAsync.mockResolvedValueOnce(undefined)
    await expect(
      runApp(BackgroundTask.register(definition, { minimumInterval: 30 })),
    ).resolves.toBe("registered")
    expect(backgroundMocks.registerTaskAsync).toHaveBeenCalledWith("sync", {
      minimumInterval: 30,
    })
  })

  it("owns the expiration listener for exactly one stream scope", async () => {
    const remove = vi.fn()
    backgroundMocks.addExpirationListener.mockImplementationOnce((listener: () => void) => {
      listener()
      return { remove }
    })
    const values = await Effect.runPromise(
      BackgroundTask.addExpirationListener.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.provide(BackgroundLive),
      ),
    )
    expect(Array.from(values)).toEqual([undefined])
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("classifies listener setup failures and interrupts expiring work", async () => {
    backgroundMocks.addExpirationListener.mockImplementationOnce(() => {
      throw Object.assign(new Error("unavailable"), { code: "ERR_UNAVAILABLE" })
    })
    const unavailable = await Effect.runPromiseExit(
      BackgroundTask.addExpirationListener.pipe(Stream.runHead, Effect.provide(BackgroundLive)),
    )
    expect(unavailable._tag).toBe("Failure")
    if (unavailable._tag === "Failure") {
      const reason = unavailable.cause.reasons[0]
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(BackgroundTask.BackgroundTaskUnavailable)
        expect(reason.error.method).toBe("addExpirationListener")
      }
    }

    let finalized = false
    const ExpiringLive = Layer.succeed(
      BackgroundTask.BackgroundTask,
      BackgroundTask.BackgroundTask.of({
        status: Effect.succeed(BackgroundTask.BackgroundTaskStatus.Available),
        register: () => Effect.void,
        unregister: () => Effect.void,
        triggerForTesting: Effect.succeed(false),
        expirations: Stream.succeed(undefined),
      }),
    )
    await Effect.runPromiseExit(
      BackgroundTask.withExpiration(
        Effect.never.pipe(Effect.ensuring(Effect.sync(() => (finalized = true)))),
      ).pipe(Effect.provide(ExpiringLive)),
    )
    expect(finalized).toBe(true)
  })

  it("does not synthesize expiration when an injected expiration stream ends empty", async () => {
    const EmptyLive = Layer.succeed(
      BackgroundTask.BackgroundTask,
      BackgroundTask.BackgroundTask.of({
        status: Effect.succeed(BackgroundTask.BackgroundTaskStatus.Available),
        register: () => Effect.void,
        unregister: () => Effect.void,
        triggerForTesting: Effect.succeed(false),
        expirations: Stream.empty,
      }),
    )
    await expect(
      Effect.runPromise(
        BackgroundTask.withExpiration(Effect.succeed("completed")).pipe(Effect.provide(EmptyLive)),
      ),
    ).resolves.toBe("completed")
  })

  it("maps Effect handler exits to BackgroundTask results", async () => {
    const runtime = ManagedRuntime.make(AppLive)
    const definition = BackgroundTask.defineTask("sync", runtime, () => Effect.succeed("done"))
    expect(definition.name).toBe("sync")
    const successExecutor = taskManagerMocks.defineTask.mock.calls[0]?.[1] as
      | ((body: unknown) => Promise<unknown>)
      | undefined
    await expect(successExecutor?.({ data: null })).resolves.toBe(
      BackgroundTask.BackgroundTaskResult.Success,
    )

    BackgroundTask.defineTask("failed", runtime, () => Effect.fail("failed"))
    const failureExecutor = taskManagerMocks.defineTask.mock.calls[1]?.[1] as
      | ((body: unknown) => Promise<unknown>)
      | undefined
    await expect(failureExecutor?.({ data: null })).resolves.toBe(
      BackgroundTask.BackgroundTaskResult.Failed,
    )

    BackgroundTask.defineTask("defect", runtime, () => Effect.die("defect"))
    const defectExecutor = taskManagerMocks.defineTask.mock.calls[2]?.[1] as
      | ((body: unknown) => Promise<unknown>)
      | undefined
    await expect(defectExecutor?.({ data: null })).resolves.toBe(
      BackgroundTask.BackgroundTaskResult.Failed,
    )
    await runtime.dispose()
  })
})
