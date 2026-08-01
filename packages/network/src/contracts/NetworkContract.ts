/**
 * Schemas and typed failures for the Network capability.
 *
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * Schema for every application-visible network connection type.
 *
 * @category schemas
 * @since 0.1.0
 */
export const NetworkType = Schema.Literals([
  "NONE",
  "UNKNOWN",
  "CELLULAR",
  "WIFI",
  "BLUETOOTH",
  "ETHERNET",
  "WIMAX",
  "VPN",
  "OTHER"
])

/**
 * An application-visible network connection type.
 *
 * @category models
 * @since 0.1.0
 */
export type NetworkType = typeof NetworkType.Type

/**
 * Schema for decoded connection and internet-reachability state.
 *
 * A connected interface does not necessarily imply internet reachability.
 * Expo reports `NONE` only as both disconnected and unreachable. Connectivity
 * and reachability otherwise remain independent because Android can report a
 * validated network whose transport maps to `UNKNOWN`.
 *
 * @category schemas
 * @since 0.1.0
 */
export const NetworkState = Schema.Struct({
  type: NetworkType,
  isConnected: Schema.Boolean,
  isInternetReachable: Schema.Boolean
}).check(
  Schema.makeFilter(
    (state) => state.type !== "NONE" || (!state.isConnected && !state.isInternetReachable),
    { expected: "NONE requires disconnected and unreachable state" }
  )
)

/**
 * Decoded connection and internet-reachability state.
 *
 * @category models
 * @since 0.1.0
 */
export type NetworkState = typeof NetworkState.Type

/**
 * Schema identifying an observable Network operation.
 *
 * @category schemas
 * @since 0.1.0
 */
export const NetworkOperation = Schema.Literals(["current", "changes"])

/**
 * An observable Network operation.
 *
 * @category models
 * @since 0.1.0
 */
export type NetworkOperation = typeof NetworkOperation.Type

/**
 * Native Expo error codes safe to expose through the Network contract.
 *
 * @category schemas
 * @since 0.1.0
 */
export const NetworkNativeCode = Schema.Literals([
  "ERR_UNAVAILABLE",
  "ERR_NETWORK_IP_ADDRESS",
  "ERR_NETWORK_UNDEFINED_INTERFACE",
  "ERR_NETWORK_SOCKET_EXCEPTION",
  "ERR_NETWORK_INVALID_PERMISSION_INTERNET",
  "ERR_NETWORK_NO_ACCESS_NETWORKINFO"
])

/**
 * An allowlisted native Expo Network error code.
 *
 * @category models
 * @since 0.1.0
 */
export type NetworkNativeCode = typeof NetworkNativeCode.Type

/**
 * Indicates that the requested native Network operation is unavailable.
 *
 * @category errors
 * @since 0.1.0
 */
export class NetworkUnavailable extends Schema.TaggedErrorClass<NetworkUnavailable>(
  "@effect-expo/network/NetworkUnavailable"
)("NetworkUnavailable", {
  operation: NetworkOperation,
  category: Schema.Literal("unavailable"),
  nativeCode: Schema.optional(NetworkNativeCode)
}) {}

/**
 * Indicates that data from the native boundary violated the Network contract.
 *
 * @category errors
 * @since 0.1.0
 */
export class NetworkContractViolation extends Schema.TaggedErrorClass<NetworkContractViolation>(
  "@effect-expo/network/NetworkContractViolation"
)("NetworkContractViolation", {
  operation: NetworkOperation,
  issue: Schema.String
}) {}

/**
 * Indicates that an Expo Network operation failed at the native boundary.
 *
 * @category errors
 * @since 0.1.0
 */
export class NetworkNativeError extends Schema.TaggedErrorClass<NetworkNativeError>(
  "@effect-expo/network/NetworkNativeError"
)("NetworkNativeError", {
  operation: NetworkOperation,
  message: Schema.String,
  category: Schema.Literal("native"),
  nativeCode: Schema.optional(NetworkNativeCode)
}) {}

/**
 * Typed failure channel shared by Network effects and streams.
 *
 * @category errors
 * @since 0.1.0
 */
export type NetworkError = NetworkUnavailable | NetworkContractViolation | NetworkNativeError

/**
 * Canonical disconnected state for tests and application initialization.
 *
 * @category constants
 * @since 0.1.0
 */
export const offline: NetworkState = {
  type: "NONE",
  isConnected: false,
  isInternetReachable: false
}
