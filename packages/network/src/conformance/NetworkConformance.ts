/**
 * Portable conformance vectors for Network implementations.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { NetworkState, NetworkType } from "../contracts/NetworkContract.ts"
import { Network } from "../generated/Network.ts"

/**
 * Result of one deterministic Network conformance vector.
 *
 * @category models
 * @since 0.1.0
 */
export interface NetworkConformanceResult {
  readonly id:
    | "network.current.shape"
    | "network.current.connectivity-semantics"
    | "network.changes.first-delivery"
    | "network.changes.subsequent-delivery"
    | "network.changes.scope-finalization"
    | "network.changes.resubscribe"
  readonly status: "pending" | "passed" | "failed"
  readonly detail: string
}

/**
 * Deterministic controls required to exercise a Network listener implementation.
 *
 * @category conformance
 * @since 0.1.0
 */
export interface NetworkChangesConformanceDriver {
  readonly emit: (state: NetworkState) => Effect.Effect<void>
  readonly registrations: Effect.Effect<number>
  readonly removals: Effect.Effect<number>
  readonly awaitRegistrations: (minimum: number) => Effect.Effect<void>
}

/**
 * User-driven native listener session. Network events come from real OS changes;
 * the session never claims it can synthesize or control them.
 *
 * @category conformance
 * @since 0.1.0
 */
export interface NetworkChangesSession {
  readonly phase:
    | "idle"
    | "awaiting-first"
    | "awaiting-subsequent"
    | "ready-to-cleanup"
    | "ready-to-resubscribe"
    | "awaiting-resubscribed"
    | "stopping"
    | "complete"
    | "failed"
  readonly results: ReadonlyArray<NetworkConformanceResult>
  readonly firstState?: NetworkState | undefined
}

const result = (
  id: NetworkConformanceResult["id"],
  passed: boolean,
  detail: string
): NetworkConformanceResult => ({
  id,
  status: passed ? "passed" : "failed",
  detail
})

const pendingResult = (
  id: NetworkConformanceResult["id"],
  detail: string
): NetworkConformanceResult => ({ id, status: "pending", detail })

const replaceResult = (
  results: ReadonlyArray<NetworkConformanceResult>,
  replacement: NetworkConformanceResult
): ReadonlyArray<NetworkConformanceResult> =>
  results.map((item) => (item.id === replacement.id ? replacement : item))

const sameState = (left: NetworkState | undefined, right: NetworkState): boolean =>
  left !== undefined &&
  left.type === right.type &&
  left.isConnected === right.isConnected &&
  left.isInternetReachable === right.isInternetReachable

/**
 * Empty interactive native listener session.
 *
 * @category conformance
 * @since 0.1.0
 */
export const idleNetworkChangesSession: NetworkChangesSession = {
  phase: "idle",
  results: []
}

/**
 * Starts an interactive native listener session.
 *
 * @category conformance
 * @since 0.1.0
 */
export const beginNetworkChangesSession = (): NetworkChangesSession => ({
  phase: "awaiting-first",
  results: [
    pendingResult("network.changes.first-delivery", "Waiting for the first native event"),
    pendingResult("network.changes.subsequent-delivery", "Waiting for a distinct subsequent event"),
    pendingResult(
      "network.changes.scope-finalization",
      "Waiting for the first Effect scoped stream to finish finalization"
    ),
    pendingResult(
      "network.changes.resubscribe",
      "Waiting for a fresh Effect stream subscription and event"
    )
  ]
})

/**
 * Records a real post-subscription native network event.
 *
 * @category conformance
 * @since 0.1.0
 */
export const observeNetworkChangesSession = (
  session: NetworkChangesSession,
  state: NetworkState
): NetworkChangesSession => {
  switch (session.phase) {
    case "awaiting-first":
      return {
        phase: "awaiting-subsequent",
        firstState: state,
        results: replaceResult(
          session.results,
          result(
            "network.changes.first-delivery",
            true,
            `Observed post-subscription ${state.type} event`
          )
        )
      }
    case "awaiting-subsequent":
      if (sameState(session.firstState, state)) return session
      return {
        phase: "ready-to-cleanup",
        firstState: session.firstState,
        results: replaceResult(
          session.results,
          result(
            "network.changes.subsequent-delivery",
            true,
            `Observed distinct subsequent ${state.type} event`
          )
        )
      }
    case "awaiting-resubscribed":
      return {
        phase: "complete",
        results: replaceResult(
          session.results,
          result(
            "network.changes.resubscribe",
            true,
            `Observed ${state.type} event after a fresh Effect stream subscription`
          )
        )
      }
    default:
      return session
  }
}

/**
 * Records completion of the first Effect scoped stream's finalization.
 *
 * This does not claim that Expo or the operating system acknowledged listener
 * deregistration.
 *
 * @category conformance
 * @since 0.1.0
 */
export const confirmNetworkChangesScopeFinalization = (
  session: NetworkChangesSession
): NetworkChangesSession =>
  session.phase === "ready-to-cleanup"
    ? {
        phase: "ready-to-resubscribe",
        results: replaceResult(
          session.results,
          result(
            "network.changes.scope-finalization",
            true,
            "The Effect stream fiber completed after scoped finalization; this does not verify Expo or OS listener deregistration"
          )
        )
      }
    : session

/**
 * Advances a cleaned-up session to a fresh Effect stream subscription.
 *
 * @category conformance
 * @since 0.1.0
 */
export const beginNetworkChangesResubscription = (
  session: NetworkChangesSession
): NetworkChangesSession =>
  session.phase === "ready-to-resubscribe"
    ? { ...session, phase: "awaiting-resubscribed" }
    : session

const pendingSessionVector = (
  phase: NetworkChangesSession["phase"]
): NetworkConformanceResult["id"] | undefined => {
  switch (phase) {
    case "awaiting-first":
      return "network.changes.first-delivery"
    case "awaiting-subsequent":
      return "network.changes.subsequent-delivery"
    case "ready-to-cleanup":
      return "network.changes.scope-finalization"
    case "ready-to-resubscribe":
    case "awaiting-resubscribed":
      return "network.changes.resubscribe"
    default:
      return undefined
  }
}

/**
 * Marks the currently pending interactive vector as failed.
 *
 * @category conformance
 * @since 0.1.0
 */
export const failNetworkChangesSession = (
  session: NetworkChangesSession,
  detail: string
): NetworkChangesSession => {
  const id = pendingSessionVector(session.phase)
  return id === undefined
    ? session
    : {
        phase: "failed",
        results: replaceResult(session.results, result(id, false, detail))
      }
}

/**
 * Marks the pending vector failed while its owned stream fiber is stopping.
 *
 * @category conformance
 * @since 0.1.0
 */
export const stopNetworkChangesSession = (
  session: NetworkChangesSession,
  detail: string
): NetworkChangesSession => {
  const failed = failNetworkChangesSession(session, detail)
  return failed.phase === "failed" ? { ...failed, phase: "stopping" } : failed
}

/**
 * Completes a requested stop after the owned stream fiber has exited.
 *
 * @category conformance
 * @since 0.1.0
 */
export const finishNetworkChangesStop = (session: NetworkChangesSession): NetworkChangesSession =>
  session.phase === "stopping" ? { ...session, phase: "failed" } : session

/**
 * Runs contract vectors shared by deterministic Layers and the live Expo adapter.
 *
 * A passing result records behavior observed from the supplied Network Layer; it
 * does not by itself prove native conformance on any platform.
 *
 * @category conformance
 * @since 0.1.0
 */
export const runNetworkConformance = Network.pipe(
  Effect.flatMap((network) =>
    network.current.pipe(
      Effect.map((state) => {
        const shapeIsValid =
          Schema.is(NetworkType)(state.type) &&
          typeof state.isConnected === "boolean" &&
          typeof state.isInternetReachable === "boolean"
        const connectivityIsConsistent = Schema.is(NetworkState)(state)

        return [
          result(
            "network.current.shape",
            shapeIsValid,
            `Received ${state.type} (connected=${state.isConnected}, reachable=${state.isInternetReachable})`
          ),
          result(
            "network.current.connectivity-semantics",
            connectivityIsConsistent,
            state.type === "NONE"
              ? "NONE must be disconnected and unreachable"
              : "Connectivity and reachability remain independently observable"
          )
        ] as const
      })
    )
  )
)

const firstChange: NetworkState = {
  type: "WIFI",
  isConnected: true,
  isInternetReachable: false
}

const secondChange: NetworkState = {
  ...firstChange,
  isInternetReachable: true
}

const resubscribedChange: NetworkState = {
  type: "NONE",
  isConnected: false,
  isInternetReachable: false
}

/**
 * Runs future-only delivery, cleanup, and resubscription vectors against any
 * deterministic Network listener driver.
 *
 * @category conformance
 * @since 0.1.0
 */
export const runNetworkChangesConformance = (driver: NetworkChangesConformanceDriver) =>
  Effect.gen(function* () {
    const network = yield* Network
    const firstFiber = yield* network.changes.pipe(
      Stream.take(2),
      Stream.runCollect,
      Effect.forkChild({ startImmediately: true })
    )
    yield* driver.awaitRegistrations(1)
    yield* driver.emit(firstChange)
    yield* driver.emit(secondChange)
    const firstValues = yield* Fiber.join(firstFiber)
    const removalsAfterFirst = yield* driver.removals

    const secondFiber = yield* network.changes.pipe(
      Stream.take(1),
      Stream.runCollect,
      Effect.forkChild({ startImmediately: true })
    )
    yield* driver.awaitRegistrations(2)
    const registrations = yield* driver.registrations
    yield* driver.emit(resubscribedChange)
    const secondValues = yield* Fiber.join(secondFiber)
    const finalRemovals = yield* driver.removals

    return [
      result(
        "network.changes.first-delivery",
        sameState(firstValues[0], firstChange),
        "The first post-subscription event is delivered without snapshot replay"
      ),
      result(
        "network.changes.subsequent-delivery",
        sameState(firstValues[1], secondChange),
        "A subsequent event is delivered in registration order"
      ),
      result(
        "network.changes.scope-finalization",
        removalsAfterFirst === 1 && finalRemovals === 2,
        `The deterministic driver observed ${finalRemovals} release callbacks; this is not native deregistration evidence`
      ),
      result(
        "network.changes.resubscribe",
        registrations === 2 && sameState(secondValues[0], resubscribedChange),
        `Observed ${registrations} independent listener registrations`
      )
    ] as const
  })
