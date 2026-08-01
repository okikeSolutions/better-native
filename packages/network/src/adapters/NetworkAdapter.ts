/**
 * Reviewed adapter between expo-network and the Effect-native Network contract.
 *
 * @since 0.1.0
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import {
  NetworkContractViolation,
  NetworkNativeError,
  NetworkNativeCode,
  NetworkState,
  NetworkUnavailable,
  type NetworkOperation
} from "../contracts/NetworkContract.ts"
import { Network } from "../generated/Network.ts"

interface NativeNetworkSubscription {
  readonly remove: () => void
}

/** @internal */
export interface NativeNetwork {
  readonly getNetworkStateAsync?: () => Promise<unknown>
  readonly addNetworkStateListener: (
    listener: (state: unknown) => void
  ) => NativeNetworkSubscription
}

const maximumPublicMessageLength = 256

const sanitizePublicMessage = (input: string, fallback: string): string => {
  let output = ""
  for (const character of input) {
    const codePoint = character.codePointAt(0) ?? 0
    output += codePoint < 32 || codePoint === 127 ? " " : character
    if (output.length >= maximumPublicMessageLength) break
  }
  const normalized = output.slice(0, maximumPublicMessageLength).trim()
  return normalized.length === 0 ? fallback : normalized
}

const readProperty = (input: unknown, property: PropertyKey): unknown => {
  try {
    return (typeof input === "object" && input !== null) || typeof input === "function"
      ? Reflect.get(input, property)
      : undefined
  } catch {
    return undefined
  }
}

const nativeFailure = (
  operation: NetworkOperation,
  cause: unknown
): NetworkUnavailable | NetworkNativeError => {
  const rawCode = readProperty(cause, "code")
  const nativeCode = NetworkNativeCode.literals.find((code) => code === rawCode)
  if (nativeCode === "ERR_UNAVAILABLE") {
    return new NetworkUnavailable({ operation, category: "unavailable", nativeCode })
  }

  const rawMessage = readProperty(cause, "message")
  return new NetworkNativeError({
    operation,
    message: sanitizePublicMessage(
      typeof rawMessage === "string" ? rawMessage : "",
      "Unknown native network failure"
    ),
    category: "native",
    nativeCode
  })
}

const readNativeState = (operation: NetworkOperation, input: unknown) =>
  Effect.try({
    try: () => {
      if ((typeof input !== "object" || input === null) && typeof input !== "function") {
        return input
      }
      return {
        type: Reflect.get(input, "type"),
        isConnected: Reflect.get(input, "isConnected"),
        isInternetReachable: Reflect.get(input, "isInternetReachable")
      }
    },
    catch: () =>
      new NetworkContractViolation({
        operation,
        issue: "Native network state could not be read"
      })
  })

const decodeNetworkState = Schema.decodeUnknownEffect(NetworkState)

const decodeState = (operation: NetworkOperation, input: unknown) =>
  readNativeState(operation, input).pipe(
    Effect.flatMap((state) =>
      decodeNetworkState(state).pipe(
        Effect.mapError(
          (parseError) =>
            new NetworkContractViolation({
              operation,
              issue: sanitizePublicMessage(parseError.message, "Native network state is invalid")
            })
        )
      )
    )
  )

const span = (operation: NetworkOperation) =>
  Effect.withSpan(`effect-expo.network.${operation}`, {
    attributes: {
      "effect-expo.capability": "network",
      "effect-expo.operation": operation
    }
  })

/** @internal */
export const layerFromNative = (native: NativeNetwork): Layer.Layer<Network> =>
  Layer.succeed(Network)({
    current:
      native.getNetworkStateAsync === undefined
        ? Effect.fail(new NetworkUnavailable({ operation: "current", category: "unavailable" }))
        : Effect.tryPromise({
            try: () => native.getNetworkStateAsync!(),
            catch: (cause) => nativeFailure("current", cause)
          }).pipe(
            Effect.flatMap((state) => decodeState("current", state)),
            span("current")
          ),
    // Expo listeners do not promise replay. Both live and test Layers therefore
    // expose future changes only; callers use `current` for an initial snapshot.
    changes: Stream.callback<unknown, NetworkUnavailable | NetworkNativeError>(
      (queue) =>
        Effect.acquireRelease(
          Effect.try({
            try: () =>
              native.addNetworkStateListener((state) => {
                Queue.offerUnsafe(queue, state)
              }),
            catch: (cause) => nativeFailure("changes", cause)
          }),
          (subscription) =>
            Effect.sync(() => {
              try {
                subscription.remove()
                return true
              } catch {
                return false
              }
            }).pipe(
              Effect.tap((removed) =>
                removed
                  ? Effect.void
                  : Effect.logWarning(
                      "effect-expo Network listener finalizer could not invoke remove"
                    )
              ),
              Effect.asVoid
            )
        ).pipe(
          Effect.catch((error) =>
            Effect.sync(() => Queue.failCauseUnsafe(queue, Cause.fail(error)))
          )
        ),
      { bufferSize: 16, strategy: "sliding" }
    ).pipe(Stream.mapEffect((state) => decodeState("changes", state).pipe(span("changes"))))
  })
