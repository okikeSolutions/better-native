import { Network, type NetworkError, type NetworkState } from "@effect-expo/network"
import {
  beginNetworkChangesResubscription,
  beginNetworkChangesSession,
  confirmNetworkChangesScopeFinalization,
  failNetworkChangesSession,
  finishNetworkChangesStop,
  idleNetworkChangesSession,
  observeNetworkChangesSession,
  runNetworkConformance,
  stopNetworkChangesSession,
  type NetworkChangesSession,
  type NetworkConformanceResult
} from "@effect-expo/network/conformance"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { useCallback, useEffect, useRef, useState } from "react"
import { acquireNetworkRuntime, type NetworkRuntimeLease } from "@/runtime/network-runtime"

interface NetworkProbe {
  readonly current: NetworkState | undefined
  readonly transitions: ReadonlyArray<NetworkState>
  readonly error: string | undefined
  readonly conformance: ReadonlyArray<NetworkConformanceResult>
  readonly conformanceRunning: boolean
  readonly changesSession: NetworkChangesSession
  readonly runConformance: () => void
  readonly startChangesConformance: () => void
  readonly startChangesResubscription: () => void
  readonly stopChangesConformance: () => void
}

interface OwnedChangesFiber {
  readonly fiber: Fiber.Fiber<unknown, unknown>
  readonly generation: number
}

const describeError = (error: NetworkError): string => {
  switch (error._tag) {
    case "NetworkUnavailable":
      return `NetworkUnavailable: ${error.operation} is unavailable`
    case "NetworkContractViolation":
      return `NetworkContractViolation: ${error.issue}`
    case "NetworkNativeError":
      return `NetworkNativeError: ${error.message}`
  }
}

export const useNetworkProbe = (): NetworkProbe => {
  const [current, setCurrent] = useState<NetworkState>()
  const [transitions, setTransitions] = useState<ReadonlyArray<NetworkState>>([])
  const [error, setError] = useState<string>()
  const [conformance, setConformance] = useState<ReadonlyArray<NetworkConformanceResult>>([])
  const [conformanceRunning, setConformanceRunning] = useState(false)
  const [changesSession, setChangesSession] = useState(idleNetworkChangesSession)
  const mounted = useRef(false)
  const runtime = useRef<NetworkRuntimeLease | undefined>(undefined)
  const conformanceFiber = useRef<Fiber.Fiber<unknown, unknown> | undefined>(undefined)
  const changesFiber = useRef<OwnedChangesFiber | undefined>(undefined)
  const changesGeneration = useRef(0)
  const changesSessionRef = useRef<NetworkChangesSession>(idleNetworkChangesSession)

  const updateChangesSession = useCallback(
    (update: (session: NetworkChangesSession) => NetworkChangesSession): void => {
      const next = update(changesSessionRef.current)
      changesSessionRef.current = next
      if (mounted.current) setChangesSession(next)
    },
    []
  )

  const startChangesListener = useCallback(
    (lease: NetworkRuntimeLease, eventCount: 1 | 2, generation: number): void => {
      const updateOwnedSession = (
        update: (session: NetworkChangesSession) => NetworkChangesSession
      ): void => {
        if (changesGeneration.current === generation) updateChangesSession(update)
      }
      const program = Network.pipe(
        Effect.flatMap((network) =>
          network.changes.pipe(
            Stream.changesWith(
              (left, right) =>
                left.type === right.type &&
                left.isConnected === right.isConnected &&
                left.isInternetReachable === right.isInternetReachable
            ),
            Stream.take(eventCount),
            Stream.runForEach((state) =>
              Effect.sync(() => {
                if (mounted.current && changesGeneration.current === generation) {
                  updateOwnedSession((session) => observeNetworkChangesSession(session, state))
                }
              })
            )
          )
        ),
        Effect.catch((failure) =>
          Effect.sync(() => {
            updateOwnedSession((session) =>
              failNetworkChangesSession(session, describeError(failure))
            )
          })
        ),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.sync(() => {
                updateOwnedSession((session) =>
                  failNetworkChangesSession(session, Cause.pretty(cause))
                )
              })
        )
      )
      const fiber = lease.runFork(program)
      changesFiber.current = { fiber, generation }
      fiber.addObserver(() => {
        const owned = changesFiber.current
        if (owned?.fiber !== fiber || owned.generation !== generation) return
        changesFiber.current = undefined
        if (changesGeneration.current !== generation) return
        updateChangesSession((session) =>
          session.phase === "stopping"
            ? finishNetworkChangesStop(session)
            : eventCount === 2
              ? confirmNetworkChangesScopeFinalization(session)
              : session
        )
      })
    },
    [updateChangesSession]
  )

  useEffect(() => {
    mounted.current = true
    const lease = acquireNetworkRuntime()
    runtime.current = lease
    const program = Effect.gen(function* () {
      const network = yield* Network
      const initial = yield* network.current
      yield* Effect.sync(() => {
        if (mounted.current) setCurrent(initial)
      })
      yield* network.changes.pipe(
        Stream.runForEach((state) =>
          Effect.sync(() => {
            if (!mounted.current) return
            setCurrent(state)
            setTransitions((existing) => [state, ...existing].slice(0, 20))
          })
        )
      )
    }).pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          if (mounted.current) setError(describeError(failure))
        })
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.sync(() => {
              if (mounted.current) setError(Cause.pretty(cause))
            })
      )
    )

    const fiber = lease.runFork(program)
    return () => {
      mounted.current = false
      runtime.current = undefined
      lease.interrupt(fiber)
      if (conformanceFiber.current !== undefined) {
        lease.interrupt(conformanceFiber.current)
        conformanceFiber.current = undefined
      }
      if (changesFiber.current !== undefined) {
        changesGeneration.current += 1
        lease.interrupt(changesFiber.current.fiber)
      }
      lease.release()
    }
  }, [updateChangesSession])

  const runConformance = useCallback(() => {
    const lease = runtime.current
    if (lease === undefined || conformanceFiber.current !== undefined) return
    setError(undefined)
    setConformanceRunning(true)
    const fiber = lease.runFork(
      runNetworkConformance.pipe(
        Effect.tap((results) =>
          Effect.sync(() => {
            if (mounted.current) setConformance(results)
          })
        ),
        Effect.catch((failure) =>
          Effect.sync(() => {
            if (mounted.current) setError(describeError(failure))
          })
        ),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.sync(() => {
                if (mounted.current) setError(Cause.pretty(cause))
              })
        )
      )
    )
    conformanceFiber.current = fiber
    fiber.addObserver(() => {
      if (conformanceFiber.current === fiber) conformanceFiber.current = undefined
      if (mounted.current) setConformanceRunning(false)
    })
  }, [])

  const startChangesConformance = useCallback(() => {
    const lease = runtime.current
    if (lease === undefined || changesFiber.current !== undefined) return
    const generation = changesGeneration.current + 1
    changesGeneration.current = generation
    updateChangesSession(() => beginNetworkChangesSession())
    startChangesListener(lease, 2, generation)
  }, [startChangesListener, updateChangesSession])

  const startChangesResubscription = useCallback(() => {
    const lease = runtime.current
    if (
      lease === undefined ||
      changesFiber.current !== undefined ||
      changesSessionRef.current.phase !== "ready-to-resubscribe"
    ) {
      return
    }
    updateChangesSession(beginNetworkChangesResubscription)
    startChangesListener(lease, 1, changesGeneration.current)
  }, [startChangesListener, updateChangesSession])

  const stopChangesConformance = useCallback(() => {
    const lease = runtime.current
    const owned = changesFiber.current
    if (lease !== undefined && owned !== undefined) {
      updateChangesSession((session) =>
        stopNetworkChangesSession(session, "Session stopped before the required native event")
      )
      lease.interrupt(owned.fiber)
    }
  }, [updateChangesSession])

  return {
    current,
    transitions,
    error,
    conformance,
    conformanceRunning,
    changesSession,
    runConformance,
    startChangesConformance,
    startChangesResubscription,
    stopChangesConformance
  }
}
