import { beforeEach, describe, expect, it, vi } from "vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

vi.mock("expo-keep-awake", () => ({
  ExpoKeepAwakeTag: "ExpoKeepAwakeDefaultTag",
  KeepAwakeEventState: { RELEASE: "release" },
  activateKeepAwake: vi.fn(),
  activateKeepAwakeAsync: vi.fn(),
  addListener: vi.fn(),
  deactivateKeepAwake: vi.fn(),
  isAvailableAsync: vi.fn(),
  useKeepAwake: vi.fn(),
}))

const ExpoKeepAwake = await import("expo-keep-awake")
const { KeepAwake, KeepAwakeFailure, KeepAwakeService, KeepAwakeUnavailable } =
  await import("../src/index")

beforeEach(() => {
  vi.clearAllMocks()
})

const provideLayer =
  <ROut, E2, RIn>(layer: Layer.Layer<ROut, E2, RIn>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.scoped(
      Layer.build(layer).pipe(Effect.flatMap((context) => Effect.provide(effect, context))),
    )

const testLayer = (options?: { readonly available?: boolean }) => {
  const activated: Array<string> = []
  const deactivated: Array<string> = []
  const layer = Layer.succeed(
    KeepAwakeService,
    KeepAwakeService.of({
      isAvailable: Effect.succeed(options?.available ?? true),
      activate: (tag) => Effect.sync(() => void activated.push(tag)),
      deactivate: (tag) => Effect.sync(() => void deactivated.push(tag)),
      events: () => Stream.empty,
    }),
  )
  return { activated, deactivated, layer }
}

describe("@better-native/keep-awake", () => {
  it("exports the keep-awake event-state enum", () => {
    expect(KeepAwake.KeepAwakeEventState).toBe(ExpoKeepAwake.KeepAwakeEventState)
  })

  it("reads native availability through the Effect API", async () => {
    vi.mocked(ExpoKeepAwake.isAvailableAsync).mockResolvedValueOnce(true)

    await expect(
      Effect.runPromise(KeepAwake.isAvailableAsync.pipe(provideLayer(KeepAwake.live))),
    ).resolves.toBe(true)
    expect(ExpoKeepAwake.isAvailableAsync).toHaveBeenCalledOnce()
  })

  it("preserves native availability failures in the typed error channel", async () => {
    const nativeCause = new Error("availability failed")
    vi.mocked(ExpoKeepAwake.isAvailableAsync).mockRejectedValueOnce(nativeCause)

    const exit = await Effect.runPromiseExit(
      KeepAwake.isAvailableAsync.pipe(provideLayer(KeepAwake.live)),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason).toBeDefined()
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(KeepAwakeFailure)
        expect(reason.error).toMatchObject({ method: "isAvailableAsync", cause: nativeCause })
      } else {
        throw new Error("expected KeepAwakeFailure")
      }
    }
  })

  it("activates default, explicit, and deprecated-alias leases", async () => {
    vi.mocked(ExpoKeepAwake.activateKeepAwakeAsync).mockResolvedValue(undefined)

    await Effect.runPromise(
      Effect.all([
        KeepAwake.activateKeepAwakeAsync(),
        KeepAwake.activateKeepAwakeAsync("navigation"),
        KeepAwake.activateKeepAwake("legacy"),
      ]).pipe(provideLayer(KeepAwake.live)),
    )

    expect(ExpoKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(3)
    expect(ExpoKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith(
      ExpoKeepAwake.ExpoKeepAwakeTag,
    )
    expect(ExpoKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith("navigation")
    expect(ExpoKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith("legacy")
  })

  it("preserves direct activation failures in the typed error channel", async () => {
    const nativeCause = new Error("wake lock denied")
    vi.mocked(ExpoKeepAwake.activateKeepAwakeAsync).mockRejectedValueOnce(nativeCause)

    const exit = await Effect.runPromiseExit(
      KeepAwake.activateKeepAwakeAsync("video-player").pipe(provideLayer(KeepAwake.live)),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason).toBeDefined()
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(KeepAwakeFailure)
        expect(reason.error).toMatchObject({ method: "activateKeepAwakeAsync", cause: nativeCause })
      } else {
        throw new Error("expected KeepAwakeFailure")
      }
    }
  })

  it("deactivates default and explicit leases", async () => {
    vi.mocked(ExpoKeepAwake.deactivateKeepAwake).mockResolvedValue(undefined)

    await Effect.runPromise(
      Effect.all([
        KeepAwake.deactivateKeepAwake(),
        KeepAwake.deactivateKeepAwake("navigation"),
      ]).pipe(provideLayer(KeepAwake.live)),
    )

    expect(ExpoKeepAwake.deactivateKeepAwake).toHaveBeenCalledTimes(2)
    expect(ExpoKeepAwake.deactivateKeepAwake).toHaveBeenCalledWith(ExpoKeepAwake.ExpoKeepAwakeTag)
    expect(ExpoKeepAwake.deactivateKeepAwake).toHaveBeenCalledWith("navigation")
  })

  it("preserves direct deactivation failures in the typed error channel", async () => {
    const nativeCause = new Error("release failed")
    vi.mocked(ExpoKeepAwake.deactivateKeepAwake).mockRejectedValueOnce(nativeCause)

    const exit = await Effect.runPromiseExit(
      KeepAwake.deactivateKeepAwake("video-player").pipe(provideLayer(KeepAwake.live)),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason).toBeDefined()
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(KeepAwakeFailure)
        expect(reason.error).toMatchObject({ method: "deactivateKeepAwake", cause: nativeCause })
      } else {
        throw new Error("expected KeepAwakeFailure")
      }
    }
  })

  it("streams default-tag events and removes the native subscription", async () => {
    const remove = vi.fn()
    vi.mocked(ExpoKeepAwake.addListener).mockImplementationOnce((listener) => {
      if (typeof listener === "function") {
        listener({ state: ExpoKeepAwake.KeepAwakeEventState.RELEASE })
      }
      return { remove }
    })

    const events = await Effect.runPromise(
      KeepAwake.addListener().pipe(Stream.take(1), Stream.runCollect, provideLayer(KeepAwake.live)),
    )

    expect(Array.from(events)).toEqual([{ state: ExpoKeepAwake.KeepAwakeEventState.RELEASE }])
    expect(remove).toHaveBeenCalledOnce()
  })

  it("passes an explicit tag to the native listener", async () => {
    const remove = vi.fn()
    vi.mocked(ExpoKeepAwake.addListener).mockImplementationOnce((tag, listener) => {
      expect(tag).toBe("video-player")
      listener?.({ state: ExpoKeepAwake.KeepAwakeEventState.RELEASE })
      return { remove }
    })

    await Effect.runPromise(
      KeepAwake.addListener("video-player").pipe(
        Stream.take(1),
        Stream.runDrain,
        provideLayer(KeepAwake.live),
      ),
    )

    expect(remove).toHaveBeenCalledOnce()
  })

  it("preserves listener registration failures", async () => {
    vi.mocked(ExpoKeepAwake.addListener).mockImplementationOnce(() => {
      throw new Error("listener unavailable")
    })

    const exit = await Effect.runPromiseExit(
      KeepAwake.addListener().pipe(Stream.take(1), Stream.runDrain, provideLayer(KeepAwake.live)),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason).toBeDefined()
      if (
        reason !== undefined &&
        Cause.isFailReason(reason) &&
        reason.error instanceof KeepAwakeFailure
      ) {
        expect(reason.error.method).toBe("addListener")
      } else {
        throw new Error("expected KeepAwakeFailure")
      }
    }
  })

  it("removes the listener when stream consumption is interrupted", async () => {
    const remove = vi.fn()
    vi.mocked(ExpoKeepAwake.addListener).mockReturnValueOnce({ remove })
    const fiber = Effect.runFork(
      KeepAwake.addListener("interrupted-listener").pipe(
        Stream.runDrain,
        provideLayer(KeepAwake.live),
      ),
    )

    await vi.waitFor(() =>
      expect(ExpoKeepAwake.addListener).toHaveBeenCalledWith(
        "interrupted-listener",
        expect.any(Function),
      ),
    )
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(remove).toHaveBeenCalledOnce()
  })

  it("acquires and releases an explicitly tagged lease with its scope", async () => {
    const test = testLayer()

    const tag = await Effect.runPromise(
      KeepAwake.keepAwake({ tag: "video-playback" }).pipe(provideLayer(test.layer)),
    )

    expect(tag).toBe("video-playback")
    expect(test.activated).toEqual(["video-playback"])
    expect(test.deactivated).toEqual(["video-playback"])
  })

  it("generates distinct tags for independent leases", async () => {
    const test = testLayer()

    const tags = await Effect.runPromise(
      Effect.all([KeepAwake.keepAwake(), KeepAwake.keepAwake()]).pipe(provideLayer(test.layer)),
    )

    expect(tags[0]).not.toBe(tags[1])
    expect(new Set(test.activated)).toEqual(new Set(tags))
    expect(new Set(test.deactivated)).toEqual(new Set(tags))
  })

  it("reference-counts overlapping scoped leases with the same explicit tag", async () => {
    const test = testLayer()
    const firstAcquired = await Effect.runPromise(Deferred.make<void>())
    const secondAcquired = await Effect.runPromise(Deferred.make<void>())
    const lease = (acquired: Deferred.Deferred<void>) =>
      KeepAwake.keepAwake({ tag: "shared-player" }).pipe(
        Effect.tap(() => Deferred.succeed(acquired, undefined)),
        Effect.andThen(Effect.never),
        provideLayer(test.layer),
      )
    const first = Effect.runFork(lease(firstAcquired))
    const second = Effect.runFork(lease(secondAcquired))

    await Effect.runPromise(Deferred.await(firstAcquired))
    await Effect.runPromise(Deferred.await(secondAcquired))
    expect(test.activated).toEqual(["shared-player"])

    await Effect.runPromise(Fiber.interrupt(first))
    expect(test.deactivated).toEqual([])

    await Effect.runPromise(Fiber.interrupt(second))
    expect(test.deactivated).toEqual(["shared-player"])
  })

  it("acquires and releases an atom-backed lease with its React lifetime", async () => {
    vi.mocked(ExpoKeepAwake.isAvailableAsync).mockResolvedValue(true)
    vi.mocked(ExpoKeepAwake.activateKeepAwakeAsync).mockResolvedValue(undefined)
    vi.mocked(ExpoKeepAwake.deactivateKeepAwake).mockResolvedValue(undefined)
    const atom = KeepAwake.keepAwakeAtom("video-player")
    expect(KeepAwake.keepAwakeAtom("video-player")).toBe(atom)
    const registry = AtomRegistry.make()
    const release = registry.mount(atom)

    await vi.waitFor(() => {
      expect(ExpoKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith("video-player")
      const result = registry.get(atom)
      expect(AsyncResult.isSuccess(result)).toBe(true)
      if (AsyncResult.isSuccess(result)) expect(result.value).toBe("video-player")
    })

    release()

    await vi.waitFor(() =>
      expect(ExpoKeepAwake.deactivateKeepAwake).toHaveBeenCalledWith("video-player"),
    )
  })

  it("reference-counts multiple mounts of the same atom", async () => {
    vi.mocked(ExpoKeepAwake.isAvailableAsync).mockResolvedValue(true)
    vi.mocked(ExpoKeepAwake.activateKeepAwakeAsync).mockResolvedValue(undefined)
    vi.mocked(ExpoKeepAwake.deactivateKeepAwake).mockResolvedValue(undefined)
    const atom = KeepAwake.keepAwakeAtom("shared-atom")
    const registry = AtomRegistry.make()
    const releaseFirst = registry.mount(atom)
    const releaseSecond = registry.mount(atom)

    await vi.waitFor(() => {
      expect(ExpoKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(1)
      expect(AsyncResult.isSuccess(registry.get(atom))).toBe(true)
    })

    releaseFirst()
    await Promise.resolve()
    expect(ExpoKeepAwake.deactivateKeepAwake).not.toHaveBeenCalled()

    releaseSecond()
    await vi.waitFor(() => {
      expect(ExpoKeepAwake.deactivateKeepAwake).toHaveBeenCalledOnce()
      expect(ExpoKeepAwake.deactivateKeepAwake).toHaveBeenCalledWith("shared-atom")
    })
  })

  it.each([
    ["availability", "isAvailableAsync"],
    ["activation", "activateKeepAwakeAsync"],
  ] as const)("surfaces %s failures through the atom", async (failure, expectedMethod) => {
    if (failure === "availability") {
      vi.mocked(ExpoKeepAwake.isAvailableAsync).mockRejectedValueOnce(
        new Error("availability failed"),
      )
    } else {
      vi.mocked(ExpoKeepAwake.isAvailableAsync).mockResolvedValueOnce(true)
      vi.mocked(ExpoKeepAwake.activateKeepAwakeAsync).mockRejectedValueOnce(
        new Error("activation failed"),
      )
    }
    const atom = KeepAwake.keepAwakeAtom(`atom-${failure}-failure`)
    const registry = AtomRegistry.make()
    const release = registry.mount(atom)

    await vi.waitFor(() => {
      const result = registry.get(atom)
      expect(AsyncResult.isFailure(result)).toBe(true)
      if (!AsyncResult.isFailure(result)) throw new Error("expected atom failure")
      const reason = result.cause.reasons[0]
      expect(reason).toBeDefined()
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBeInstanceOf(KeepAwakeFailure)
        expect(reason.error).toMatchObject({ method: expectedMethod })
      } else {
        throw new Error("expected KeepAwakeFailure")
      }
    })

    release()
  })

  it("retains deactivation failures as finalizer defects", async () => {
    const nativeCause = new Error("release failed")
    const service = KeepAwakeService.of({
      isAvailable: Effect.succeed(true),
      activate: () => Effect.void,
      deactivate: () =>
        Effect.fail(new KeepAwakeFailure({ method: "deactivateKeepAwake", cause: nativeCause })),
      events: () => Stream.empty,
    })
    const layer = Layer.succeed(KeepAwakeService, service)

    const exit = await Effect.runPromiseExit(
      KeepAwake.keepAwake({ tag: "failing-finalizer" }).pipe(provideLayer(layer)),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") throw new Error("expected finalizer failure")
    const reason = exit.cause.reasons[0]
    expect(reason).toBeDefined()
    if (reason !== undefined && Cause.isDieReason(reason)) {
      expect(reason.defect).toBeInstanceOf(KeepAwakeFailure)
      expect(reason.defect).toMatchObject({ method: "deactivateKeepAwake", cause: nativeCause })
    } else {
      throw new Error("expected KeepAwake finalizer defect")
    }
  })

  it("releases a lease when the scoped use fails", async () => {
    const test = testLayer()

    const exit = await Effect.runPromiseExit(
      KeepAwake.keepAwake({ tag: "failed-use" }).pipe(
        Effect.andThen(Effect.fail("expected failure")),
        provideLayer(test.layer),
      ),
    )

    expect(exit._tag).toBe("Failure")
    expect(test.activated).toEqual(["failed-use"])
    expect(test.deactivated).toEqual(["failed-use"])
  })

  it("releases a lease when the scoped use is interrupted", async () => {
    const test = testLayer()
    const acquired = await Effect.runPromise(Deferred.make<void>())
    const program = KeepAwake.keepAwake({ tag: "interrupted-use" }).pipe(
      Effect.tap(() => Deferred.succeed(acquired, undefined)),
      Effect.andThen(Effect.never),
      provideLayer(test.layer),
    )
    const fiber = Effect.runFork(program)

    await Effect.runPromise(Deferred.await(acquired))
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(test.activated).toEqual(["interrupted-use"])
    expect(test.deactivated).toEqual(["interrupted-use"])
  })

  it("fails before activation when keep-awake is unavailable", async () => {
    const test = testLayer({ available: false })

    const exit = await Effect.runPromiseExit(KeepAwake.keepAwake().pipe(provideLayer(test.layer)))

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason).toBeDefined()
      if (
        reason !== undefined &&
        Cause.isFailReason(reason) &&
        reason.error instanceof KeepAwakeUnavailable
      ) {
        expect(reason.error.method).toBe("activateKeepAwakeAsync")
      } else {
        throw new Error("expected KeepAwakeUnavailable")
      }
    }
    expect(test.activated).toEqual([])
    expect(test.deactivated).toEqual([])
  })

  it("wraps Expo activation failures", async () => {
    vi.mocked(ExpoKeepAwake.isAvailableAsync).mockResolvedValueOnce(true)
    vi.mocked(ExpoKeepAwake.activateKeepAwakeAsync).mockRejectedValueOnce(
      new Error("wake lock denied"),
    )

    const exit = await Effect.runPromiseExit(
      KeepAwake.keepAwake({ tag: "live" }).pipe(provideLayer(KeepAwake.live)),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause.reasons[0]
      expect(reason).toBeDefined()
      if (
        reason !== undefined &&
        Cause.isFailReason(reason) &&
        reason.error instanceof KeepAwakeFailure
      ) {
        expect(reason.error.method).toBe("activateKeepAwakeAsync")
      } else {
        throw new Error("expected KeepAwakeFailure")
      }
    }
  })
})
