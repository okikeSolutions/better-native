import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ExpoSecureStore from "expo-secure-store"

/**
 * Numeric value describing when an iOS Keychain item is accessible.
 *
 * @category models
 * @since 0.0.0
 */
export type KeychainAccessibilityConstant = ExpoSecureStore.KeychainAccessibilityConstant

/**
 * Native SecureStore options, including Keychain service, access group, accessibility, and
 * biometric-authentication settings.
 *
 * The same options must be supplied when reading or deleting an item that was written with a
 * custom `keychainService`.
 *
 * @category models
 * @since 0.0.0
 */
export type SecureStoreOptions = ExpoSecureStore.SecureStoreOptions

/**
 * Makes an item available after the device has been unlocked once since restart.
 *
 * @category accessibility
 * @since 0.0.0
 */
export const AFTER_FIRST_UNLOCK = ExpoSecureStore.AFTER_FIRST_UNLOCK

/**
 * Makes an item available after first unlock without migrating it to another device.
 *
 * @category accessibility
 * @since 0.0.0
 */
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY =
  ExpoSecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY

/**
 * Makes an item available regardless of device lock state.
 *
 * @deprecated Use an accessibility level that provides user protection, such as
 * {@link AFTER_FIRST_UNLOCK}.
 * @category accessibility
 * @since 0.0.0
 */
export const ALWAYS = ExpoSecureStore.ALWAYS

/**
 * Makes an item always available without migrating it to another device.
 *
 * @deprecated Use an accessibility level that provides user protection, such as
 * {@link AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY}.
 * @category accessibility
 * @since 0.0.0
 */
export const ALWAYS_THIS_DEVICE_ONLY = ExpoSecureStore.ALWAYS_THIS_DEVICE_ONLY

/**
 * Makes an item available only on this device while a device passcode remains configured.
 *
 * @category accessibility
 * @since 0.0.0
 */
export const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY = ExpoSecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY

/**
 * Makes an item available only while the device is unlocked.
 *
 * @category accessibility
 * @since 0.0.0
 */
export const WHEN_UNLOCKED = ExpoSecureStore.WHEN_UNLOCKED

/**
 * Makes an item available while unlocked without migrating it to another device.
 *
 * @category accessibility
 * @since 0.0.0
 */
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = ExpoSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY

/**
 * Tagged error raised when a SecureStore operation fails.
 *
 * Native errors, validation errors, and biometric prompt cancellation are retained in `cause`.
 *
 * @category errors
 * @since 0.0.0
 */
export class SecureStoreFailure extends Data.TaggedError("SecureStoreFailure")<{
  readonly method: string
  readonly key?: string
  readonly cause: unknown
}> {}

/**
 * SecureStore service contract used by the Effect-native API.
 *
 * @category services
 * @since 0.0.0
 */
export interface Service {
  readonly isAvailable: Effect.Effect<boolean, SecureStoreFailure>
  readonly canUseBiometricAuthentication: Effect.Effect<boolean, SecureStoreFailure>
  readonly deleteItem: (
    key: string,
    options?: SecureStoreOptions,
  ) => Effect.Effect<void, SecureStoreFailure>
  readonly getItem: (
    key: string,
    options?: SecureStoreOptions,
  ) => Effect.Effect<string | null, SecureStoreFailure>
  readonly getItemAsync: (
    key: string,
    options?: SecureStoreOptions,
  ) => Effect.Effect<string | null, SecureStoreFailure>
  readonly setItem: (
    key: string,
    value: string,
    options?: SecureStoreOptions,
  ) => Effect.Effect<void, SecureStoreFailure>
  readonly setItemAsync: (
    key: string,
    value: string,
    options?: SecureStoreOptions,
  ) => Effect.Effect<void, SecureStoreFailure>
}

/**
 * Context tag for accessing the secure-store service from an Effect.
 *
 * @category services
 * @since 0.0.0
 */
export class SecureStore extends Context.Service<SecureStore, Service>()(
  "@better-native/secure-store/SecureStore",
) {}

const failure = (method: string, cause: unknown, key?: string) =>
  new SecureStoreFailure(key === undefined ? { method, cause } : { method, key, cause })

const syncMethod = <A>(method: string, run: () => A, key?: string) =>
  Effect.try({ try: run, catch: (cause) => failure(method, cause, key) })

const asyncMethod = <A>(method: string, run: () => Promise<A>, key?: string) =>
  Effect.tryPromise({ try: run, catch: (cause) => failure(method, cause, key) })

/**
 * Checks whether SecureStore is available on the current device.
 *
 * @category readings
 * @since 0.0.0
 */
export const isAvailableAsync = Effect.flatMap(SecureStore, (store) => store.isAvailable)

/**
 * Checks whether the device can protect values with biometric authentication.
 *
 * @category readings
 * @since 0.0.0
 */
export const canUseBiometricAuthentication = Effect.flatMap(
  SecureStore,
  (store) => store.canUseBiometricAuthentication,
)

/**
 * Deletes the value associated with a key.
 *
 * @category operations
 * @since 0.0.0
 */
export const deleteItemAsync = (key: string, options?: SecureStoreOptions) =>
  Effect.flatMap(SecureStore, (store) => store.deleteItem(key, options))

/**
 * Reads a value through Expo's asynchronous API.
 *
 * Missing and biometrically invalidated values are represented by `null`. Native failures and
 * authentication cancellation fail with {@link SecureStoreFailure}.
 *
 * @example
 * ```ts
 * import { SecureStore } from "@better-native/secure-store"
 * import * as Effect from "effect/Effect"
 *
 * const sessionToken = SecureStore.getItemAsync("session.token").pipe(
 *   Effect.provide(SecureStore.live),
 * )
 * ```
 *
 * @category readings
 * @since 0.0.0
 */
export const getItemAsync = (key: string, options?: SecureStoreOptions) =>
  Effect.flatMap(SecureStore, (store) => store.getItemAsync(key, options))

/**
 * Reads a value through Expo's synchronous API when the Effect is executed.
 *
 * This can block the JavaScript thread while `requireAuthentication` is enabled. Prefer
 * {@link getItemAsync} unless synchronous native access is explicitly required.
 *
 * @category readings
 * @since 0.0.0
 */
export const getItem = (key: string, options?: SecureStoreOptions) =>
  Effect.flatMap(SecureStore, (store) => store.getItem(key, options))

/**
 * Stores a value through Expo's asynchronous API.
 *
 * @category operations
 * @since 0.0.0
 */
export const setItemAsync = (key: string, value: string, options?: SecureStoreOptions) =>
  Effect.flatMap(SecureStore, (store) => store.setItemAsync(key, value, options))

/**
 * Stores a value through Expo's synchronous API when the Effect is executed.
 *
 * This can block the JavaScript thread while `requireAuthentication` is enabled. Prefer
 * {@link setItemAsync} unless synchronous native access is explicitly required.
 *
 * @category operations
 * @since 0.0.0
 */
export const setItem = (key: string, value: string, options?: SecureStoreOptions) =>
  Effect.flatMap(SecureStore, (store) => store.setItem(key, value, options))

/**
 * Live secure-store layer backed by Expo SecureStore.
 *
 * @category layers
 * @since 0.0.0
 */
export const live = Layer.succeed(
  SecureStore,
  SecureStore.of({
    isAvailable: asyncMethod("isAvailableAsync", ExpoSecureStore.isAvailableAsync),
    canUseBiometricAuthentication: syncMethod(
      "canUseBiometricAuthentication",
      ExpoSecureStore.canUseBiometricAuthentication,
    ),
    deleteItem: (key, options) =>
      asyncMethod("deleteItemAsync", () => ExpoSecureStore.deleteItemAsync(key, options), key),
    getItem: (key, options) =>
      syncMethod("getItem", () => ExpoSecureStore.getItem(key, options), key),
    getItemAsync: (key, options) =>
      asyncMethod("getItemAsync", () => ExpoSecureStore.getItemAsync(key, options), key),
    setItem: (key, value, options) =>
      syncMethod("setItem", () => ExpoSecureStore.setItem(key, value, options), key),
    setItemAsync: (key, value, options) =>
      asyncMethod("setItemAsync", () => ExpoSecureStore.setItemAsync(key, value, options), key),
  }),
)
