import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as SynchronizedRef from "effect/SynchronizedRef"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as ExpoKeepAwake from "expo-keep-awake"

/**
 * Runtime keep-awake event-state enum.
 *
 * @category models
 * @since 0.0.0
 */
export const KeepAwakeEventState = ExpoKeepAwake.KeepAwakeEventState

/**
 * Keep-awake event-state value.
 *
 * @category models
 * @since 0.0.0
 */
export type KeepAwakeEventState = ExpoKeepAwake.KeepAwakeEventState

/**
 * Event emitted when a keep-awake lease changes state.
 *
 * @category models
 * @since 0.0.0
 */
export type KeepAwakeEvent = ExpoKeepAwake.KeepAwakeEvent

/**
 * Expo's shared default tag for manual keep-awake operations.
 *
 * The scoped {@link keepAwake} API generates isolated tags when one is not supplied, while the
 * exact-name manual APIs preserve Expo's shared-default behavior.
 *
 * @category models
 * @since 0.0.0
 */
export const ExpoKeepAwakeTag = ExpoKeepAwake.ExpoKeepAwakeTag

/**
 * Options for acquiring a scoped keep-awake lease.
 *
 * When `tag` is omitted, every acquisition receives a distinct generated tag so independently
 * scoped callers cannot release one another's wake locks. Acquisitions using the same explicit tag
 * share a reference-counted native lease.
 *
 * @category models
 * @since 0.0.0
 */
export interface KeepAwakeLeaseOptions {
  readonly tag?: string
}

/**
 * Tagged error raised when keep-awake support is unavailable on the current platform.
 *
 * @category errors
 * @since 0.0.0
 */
export class KeepAwakeUnavailable extends Data.TaggedError("KeepAwakeUnavailable")<{
  readonly method: string
}> {}

/**
 * Tagged error raised when an Expo KeepAwake operation fails.
 *
 * @category errors
 * @since 0.0.0
 */
export class KeepAwakeFailure extends Data.TaggedError("KeepAwakeFailure")<{
  readonly method: string
  readonly cause: unknown
}> {}

/**
 * Keep-awake service contract used by the Effect-native API.
 *
 * @category services
 * @since 0.0.0
 */
export interface Service {
  readonly isAvailable: Effect.Effect<boolean, KeepAwakeFailure>
  readonly activate: (tag: string) => Effect.Effect<void, KeepAwakeFailure>
  readonly deactivate: (tag: string) => Effect.Effect<void, KeepAwakeFailure>
  readonly events: (tag?: string) => Stream.Stream<KeepAwakeEvent, KeepAwakeFailure>
}

/**
 * Context tag for accessing the keep-awake service from an Effect.
 *
 * @category services
 * @since 0.0.0
 */
export class KeepAwake extends Context.Service<KeepAwake, Service>()(
  "@better-native/keep-awake/KeepAwake",
) {}

const failure = (method: string, cause: unknown) => new KeepAwakeFailure({ method, cause })

const method = <A>(name: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => failure(name, cause) })

let generatedTag = 0

const nextTag = () => `@better-native/keep-awake/${++generatedTag}`

const scopedLeaseCounts = new WeakMap<
  Service,
  SynchronizedRef.SynchronizedRef<Map<string, number>>
>()

const leaseCountsFor = (service: Service) => {
  const existing = scopedLeaseCounts.get(service)
  if (existing !== undefined) return existing
  const created = SynchronizedRef.makeUnsafe(new Map<string, number>())
  scopedLeaseCounts.set(service, created)
  return created
}

const acquireScopedLease = (service: Service, tag: string) =>
  SynchronizedRef.modifyEffect(leaseCountsFor(service), (counts) => {
    const count = counts.get(tag) ?? 0
    const next = new Map(counts)
    next.set(tag, count + 1)
    return count === 0
      ? service.activate(tag).pipe(Effect.as([tag, next] as const))
      : Effect.succeed([tag, next] as const)
  })

const releaseScopedLease = (service: Service, tag: string) =>
  SynchronizedRef.modifyEffect(leaseCountsFor(service), (counts) => {
    const count = counts.get(tag) ?? 0
    const next = new Map(counts)
    if (count > 1) {
      next.set(tag, count - 1)
      return Effect.succeed([undefined, next] as const)
    }
    next.delete(tag)
    return service.deactivate(tag).pipe(Effect.as([undefined, next] as const))
  })

/**
 * Checks whether the keep-awake API is available on the current platform.
 *
 * @category readings
 * @since 0.0.0
 */
export const isAvailableAsync = Effect.flatMap(KeepAwake, (keepAwake) => keepAwake.isAvailable)

/**
 * Activates a keep-awake lease for a tag, defaulting to {@link ExpoKeepAwakeTag}.
 *
 * Prefer {@link keepAwake} for application code so deactivation is tied to an Effect scope.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { KeepAwake } from "@better-native/keep-awake"
 *
 * const program = KeepAwake.activateKeepAwakeAsync().pipe(
 *   Effect.andThen(KeepAwake.deactivateKeepAwake()),
 *   Effect.provide(KeepAwake.live),
 * )
 * ```
 *
 * @category operations
 * @since 0.0.0
 */
export const activateKeepAwakeAsync = (tag: string = ExpoKeepAwakeTag) =>
  Effect.flatMap(KeepAwake, (keepAwake) => keepAwake.activate(tag))

/**
 * Activates a keep-awake lease for a tag, defaulting to {@link ExpoKeepAwakeTag}.
 *
 * @deprecated Use {@link activateKeepAwakeAsync}.
 * @category operations
 * @since 0.0.0
 */
export const activateKeepAwake = (tag: string = ExpoKeepAwakeTag) => activateKeepAwakeAsync(tag)

/**
 * Deactivates the keep-awake lease associated with a tag, defaulting to
 * {@link ExpoKeepAwakeTag}.
 *
 * Prefer {@link keepAwake} for application code so cleanup cannot be skipped by interruption or
 * failure.
 *
 * @category operations
 * @since 0.0.0
 */
export const deactivateKeepAwake = (tag: string = ExpoKeepAwakeTag) =>
  Effect.flatMap(KeepAwake, (keepAwake) => keepAwake.deactivate(tag))

/**
 * Streams keep-awake state changes for the default or supplied tag.
 *
 * Expo emits these events on web and treats the listener as a no-op on native. The native
 * subscription is removed when the stream scope closes.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { KeepAwake } from "@better-native/keep-awake"
 *
 * const firstRelease = KeepAwake.addListener().pipe(
 *   Stream.take(1),
 *   Stream.runCollect,
 *   Effect.provide(KeepAwake.live),
 * )
 * ```
 *
 * @category streams
 * @since 0.0.0
 */
export const addListener = (tag?: string) =>
  Stream.unwrap(Effect.map(KeepAwake, (keepAwake) => keepAwake.events(tag)))

/**
 * Acquires a keep-awake lease for the lifetime of the surrounding Effect scope.
 *
 * Overlapping scopes with the same explicit tag share one native activation, which is released when
 * the final scope closes.
 *
 * Activation failures remain typed. A deactivation failure occurs during finalization, where
 * Effect requires an infallible finalizer, so it is retained as a defect instead of being silently
 * discarded.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { KeepAwake } from "@better-native/keep-awake"
 *
 * const videoPlayback = Effect.scoped(
 *   KeepAwake.keepAwake({ tag: "video-player" }).pipe(Effect.provide(KeepAwake.live)),
 * )
 * ```
 *
 * @category resources
 * @since 0.0.0
 */
export const keepAwake = (options: KeepAwakeLeaseOptions = {}) =>
  Effect.gen(function* () {
    const service = yield* KeepAwake
    const available = yield* service.isAvailable
    if (!available) {
      return yield* new KeepAwakeUnavailable({ method: "activateKeepAwakeAsync" })
    }

    const tag = options.tag ?? nextTag()
    return yield* Effect.acquireRelease(acquireScopedLease(service, tag), () =>
      releaseScopedLease(service, tag).pipe(Effect.orDie),
    )
  })

const makeEvents = (tag?: string) =>
  Stream.callback<KeepAwakeEvent, KeepAwakeFailure>((queue) =>
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          const listener = (event: KeepAwakeEvent) => {
            Queue.offerUnsafe(queue, event)
          }
          return tag === undefined
            ? ExpoKeepAwake.addListener(listener)
            : ExpoKeepAwake.addListener(tag, listener)
        },
        catch: (cause) => failure("addListener", cause),
      }).pipe(Effect.tapError((cause) => Queue.fail(queue, cause))),
      (subscription) => Effect.sync(() => subscription.remove()),
    ),
  )

/**
 * Live keep-awake layer backed by Expo KeepAwake.
 *
 * @category layers
 * @since 0.0.0
 */
export const live = Layer.succeed(
  KeepAwake,
  KeepAwake.of({
    isAvailable: method("isAvailableAsync", ExpoKeepAwake.isAvailableAsync),
    activate: (tag) =>
      method("activateKeepAwakeAsync", () => ExpoKeepAwake.activateKeepAwakeAsync(tag)),
    deactivate: (tag) =>
      method("deactivateKeepAwake", () => ExpoKeepAwake.deactivateKeepAwake(tag)),
    events: makeEvents,
  }),
)

// The atom is the React integration entry point and intentionally owns its live layer.
// oxlint-disable effecttsgo/strict-effect-provide
const keepAwakeAtoms = Atom.family((tag: string | undefined) =>
  Atom.make((tag === undefined ? keepAwake() : keepAwake({ tag })).pipe(Effect.provide(live))),
)
// oxlint-enable effecttsgo/strict-effect-provide

/**
 * Returns an atom that keeps the screen awake while it is mounted.
 *
 * React applications can consume the returned atom with `@effect/atom-react`. The atom acquires a
 * scoped keep-awake lease when its first consumer mounts and releases that lease after its last
 * consumer unmounts. Calls with the same explicit tag share one atom and therefore one lease.
 *
 * @example
 * ```ts
 * import { KeepAwake } from "@better-native/keep-awake"
 *
 * const videoPlayerKeepAwake = KeepAwake.keepAwakeAtom("video-player")
 * ```
 *
 * @category atoms
 * @since 0.0.0
 */
export const keepAwakeAtom = (tag?: string) => keepAwakeAtoms(tag)
