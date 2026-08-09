import { beforeEach, describe, expect, it, vi } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"

/* oxlint-disable effecttsgo/strict-effect-provide -- test runtime entry points */

const mocks = vi.hoisted(() => ({
  defineTask: vi.fn(),
  isAvailableAsync: vi.fn(),
  isTaskDefined: vi.fn(),
  isTaskRegisteredAsync: vi.fn(),
  getTaskOptionsAsync: vi.fn(),
  getRegisteredTasksAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
  unregisterAllTasksAsync: vi.fn(),
}))

vi.mock("expo-task-manager", () => mocks)

const TaskManager = await import("../src/TaskManager.ts")

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TaskManager.live)) as Effect.Effect<A, E>)

describe("@better-native/task-manager", () => {
  beforeEach(() => vi.clearAllMocks())

  it("wraps persistent task inspection and removal through the live service", async () => {
    mocks.isAvailableAsync.mockResolvedValueOnce(true)
    mocks.isTaskDefined.mockReturnValueOnce(true)
    mocks.isTaskRegisteredAsync.mockResolvedValueOnce(true)
    mocks.getTaskOptionsAsync.mockResolvedValueOnce(null)
    mocks.getRegisteredTasksAsync.mockResolvedValueOnce([])
    mocks.unregisterTaskAsync.mockResolvedValueOnce(undefined)
    mocks.unregisterAllTasksAsync.mockResolvedValueOnce(undefined)

    await expect(run(TaskManager.isAvailableAsync)).resolves.toBe(true)
    await expect(run(TaskManager.isTaskDefined("sync"))).resolves.toBe(true)
    await expect(run(TaskManager.isTaskRegisteredAsync("sync"))).resolves.toBe(true)
    await expect(run(TaskManager.getTaskOptionsAsync("sync"))).resolves.toBeNull()
    await expect(run(TaskManager.getRegisteredTasksAsync)).resolves.toEqual([])
    await expect(run(TaskManager.unregisterTaskAsync("sync"))).resolves.toBeUndefined()
    await expect(run(TaskManager.unregisterAllTasksAsync)).resolves.toBeUndefined()
  })

  it("preserves unavailable native operations as typed failures", async () => {
    mocks.isTaskRegisteredAsync.mockRejectedValueOnce(
      Object.assign(new Error("unavailable"), { code: "ERR_UNAVAILABLE" }),
    )
    const exit = await Effect.runPromiseExit(
      TaskManager.isTaskRegisteredAsync("sync").pipe(Effect.provide(TaskManager.live)),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason).toBeDefined()
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(TaskManager.TaskManagerUnavailable)
        expect(reason.error.method).toBe("isTaskRegisteredAsync")
      } else {
        throw new Error("expected TaskManagerUnavailable")
      }
    }
  })

  it("preserves ordinary native failures separately", async () => {
    mocks.unregisterTaskAsync.mockRejectedValueOnce(new Error("native failure"))
    const exit = await Effect.runPromiseExit(
      TaskManager.unregisterTaskAsync("sync").pipe(Effect.provide(TaskManager.live)),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(TaskManager.TaskManagerFailure)
        expect(reason.error.method).toBe("unregisterTaskAsync")
      } else {
        throw new Error("expected TaskManagerFailure")
      }
    }
  })

  it("registers an Effect handler synchronously and scopes its resources", async () => {
    const runtime = ManagedRuntime.make(TaskManager.live)
    const released = vi.fn()
    TaskManager.defineTask("sync", runtime, () =>
      Effect.acquireRelease(Effect.succeed("complete"), () => Effect.sync(released)),
    )
    expect(mocks.defineTask).toHaveBeenCalledTimes(1)
    const executor = mocks.defineTask.mock.calls[0]?.[1] as (() => Promise<unknown>) | undefined
    await expect(executor?.()).resolves.toBe("complete")
    expect(released).toHaveBeenCalledTimes(1)
  })

  it("does not mint a definition token for an invalid task name", () => {
    const runtime = ManagedRuntime.make(TaskManager.live)
    expect(() => TaskManager.defineTask("", runtime, () => Effect.void)).toThrow(TypeError)
    expect(mocks.defineTask).not.toHaveBeenCalled()
  })

  it("passes task bodies through the supplied runtime on each invocation", async () => {
    const runtime = ManagedRuntime.make(TaskManager.live)
    TaskManager.defineTask("body", runtime, ({ data }) =>
      Effect.succeed((data as { readonly value: string }).value),
    )
    const executor = mocks.defineTask.mock.calls[0]?.[1] as
      | ((body: { readonly data: { readonly value: string } }) => Promise<unknown>)
      | undefined
    await expect(executor?.({ data: { value: "handled" } })).resolves.toBe("handled")
  })
})
