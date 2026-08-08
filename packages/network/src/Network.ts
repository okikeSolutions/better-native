import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as ExpoNetwork from "expo-network"

/**
 * Runtime network-state-type enum re-exported for schemas and comparisons.
 *
 * @category models
 * @since 0.0.0
 */
export const NetworkStateType = ExpoNetwork.NetworkStateType

/**
 * Network-state-type enum value type.
 *
 * @category models
 * @since 0.0.0
 */
export type NetworkStateType = ExpoNetwork.NetworkStateType

/**
 * Schema for the current network connection state.
 *
 * @category models
 * @since 0.0.0
 */
export const NetworkState = Schema.Struct({
  type: Schema.optional(
    Schema.Literals([
      "NONE",
      "UNKNOWN",
      "CELLULAR",
      "WIFI",
      "BLUETOOTH",
      "ETHERNET",
      "WIMAX",
      "VPN",
      "OTHER",
    ]),
  ),
  isConnected: Schema.optional(Schema.Boolean),
  isInternetReachable: Schema.optional(Schema.Boolean),
})

/**
 * Network-state value returned by {@link getNetworkStateAsync}.
 *
 * @category models
 * @since 0.0.0
 */
export type NetworkState = Schema.Schema.Type<typeof NetworkState>

/**
 * Event emitted when the network state changes.
 *
 * @category models
 * @since 0.0.0
 */
export type NetworkStateEvent = ExpoNetwork.NetworkStateEvent

/**
 * Native event subscription returned by Expo listener APIs.
 *
 * @category models
 * @since 0.0.0
 */
export type Subscription = ReturnType<typeof ExpoNetwork.addNetworkStateListener>

/**
 * Tagged error for network operations that are unavailable on the current platform.
 *
 * @category errors
 * @since 0.0.0
 */
export class NetworkUnavailable extends Data.TaggedError("NetworkUnavailable")<{
  readonly method: string
}> {}

/**
 * Tagged error for failed network native operations.
 *
 * @category errors
 * @since 0.0.0
 */
export class NetworkFailure extends Data.TaggedError("NetworkFailure")<{
  readonly method: string
  readonly cause: unknown
}> {}

/**
 * Network service contract used by the Effect-native API.
 *
 * @category services
 * @since 0.0.0
 */
export interface Service {
  readonly getState: Effect.Effect<NetworkState, NetworkUnavailable | NetworkFailure>
  readonly getIpAddress: Effect.Effect<string, NetworkUnavailable | NetworkFailure>
  readonly isAirplaneModeEnabled: Effect.Effect<boolean, NetworkUnavailable | NetworkFailure>
  readonly stateChanges: Stream.Stream<NetworkStateEvent, NetworkFailure>
}

/**
 * Context tag for accessing the network service from an Effect.
 *
 * @category services
 * @since 0.0.0
 */
export class Network extends Context.Service<Network, Service>()(
  "@better-native/network/Network",
) {}

const unavailable = (method: string) => new NetworkUnavailable({ method })
const failure = (method: string, cause: unknown) => new NetworkFailure({ method, cause })

const isUnavailable = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ERR_UNAVAILABLE"

const nativeMethod = <A>(method: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => (isUnavailable(cause) ? unavailable(method) : failure(method, cause)),
  })

const decodeNetworkState = (value: unknown) =>
  Schema.decodeUnknownEffect(NetworkState)(value).pipe(
    Effect.mapError((cause) => failure("getNetworkStateAsync", cause)),
  )

/**
 * Reads the current network connection state.
 *
 * Fails with {@link NetworkUnavailable} when the native API is unavailable and with
 * {@link NetworkFailure} when the native call rejects or decoding fails.
 *
 * @category readings
 * @since 0.0.0
 */
export const getNetworkStateAsync = Effect.flatMap(Network, (network) => network.getState)

/**
 * Reads the current IPv4 address.
 *
 * Fails with {@link NetworkUnavailable} when the native API is unavailable and with
 * {@link NetworkFailure} when the native call rejects.
 *
 * @category readings
 * @since 0.0.0
 */
export const getIpAddressAsync = Effect.flatMap(Network, (network) => network.getIpAddress)

/**
 * Checks whether airplane mode is enabled.
 *
 * Fails with {@link NetworkUnavailable} when the native API is unavailable and with
 * {@link NetworkFailure} when the native call rejects.
 *
 * @category readings
 * @since 0.0.0
 */
export const isAirplaneModeEnabledAsync = Effect.flatMap(
  Network,
  (network) => network.isAirplaneModeEnabled,
)

/**
 * Streams network-state change events.
 *
 * The native subscription is removed when the stream scope closes.
 *
 * @category streams
 * @since 0.0.0
 */
export const addNetworkStateListener = Stream.unwrap(
  Effect.map(Network, (network) => network.stateChanges),
)

const makeStateChanges = Stream.callback<NetworkStateEvent, NetworkFailure>((queue) =>
  Effect.acquireRelease(
    Effect.try({
      try: () =>
        ExpoNetwork.addNetworkStateListener((event) => {
          Queue.offerUnsafe(queue, event)
        }),
      catch: (cause) => failure("addNetworkStateListener", cause),
    }).pipe(Effect.tapError((cause) => Queue.fail(queue, cause))),
    (subscription) => Effect.sync(() => subscription.remove()),
  ),
)

/**
 * Live network layer backed by Expo Network.
 *
 * @category layers
 * @since 0.0.0
 */
export const live = Layer.succeed(
  Network,
  Network.of({
    getState: nativeMethod("getNetworkStateAsync", ExpoNetwork.getNetworkStateAsync).pipe(
      Effect.flatMap(decodeNetworkState),
    ),
    getIpAddress: nativeMethod("getIpAddressAsync", ExpoNetwork.getIpAddressAsync),
    isAirplaneModeEnabled: nativeMethod(
      "isAirplaneModeEnabledAsync",
      ExpoNetwork.isAirplaneModeEnabledAsync,
    ),
    stateChanges: makeStateChanges,
  }),
)

/**
 * Atom containing the initial network state and subsequent native state changes.
 *
 * React applications can consume this atom with `@effect/atom-react`. The atom exposes Effect's
 * async result state instead of hiding failures in a React-only hook.
 *
 * @category atoms
 * @since 0.0.0
 */
export const networkStateAtom = Atom.make(
  Stream.merge(Stream.fromEffect(getNetworkStateAsync), addNetworkStateListener).pipe(
    Stream.provide(live),
  ),
  { initialValue: {} },
)
