export type KeychainAccessibilityConstant = number
export interface SecureStoreOptions {
  readonly keychainService?: string
  readonly requireAuthentication?: boolean
  readonly authenticationPrompt?: string
  readonly keychainAccessible?: KeychainAccessibilityConstant
  readonly accessGroup?: string
}
export declare const AFTER_FIRST_UNLOCK: KeychainAccessibilityConstant
export declare const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: KeychainAccessibilityConstant
export declare const ALWAYS: KeychainAccessibilityConstant
export declare const ALWAYS_THIS_DEVICE_ONLY: KeychainAccessibilityConstant
export declare const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: KeychainAccessibilityConstant
export declare const WHEN_UNLOCKED: KeychainAccessibilityConstant
export declare const WHEN_UNLOCKED_THIS_DEVICE_ONLY: KeychainAccessibilityConstant
export declare const isAvailableAsync: () => Promise<boolean>
export declare const canUseBiometricAuthentication: () => boolean
export declare const setItemAsync: (
  key: string,
  value: string,
  options?: SecureStoreOptions,
) => Promise<void>
export declare const getItemAsync: (
  key: string,
  options?: SecureStoreOptions,
) => Promise<string | null>
export declare const deleteItemAsync: (key: string, options?: SecureStoreOptions) => Promise<void>
export declare const setItem: (key: string, value: string, options?: SecureStoreOptions) => void
export declare const getItem: (key: string, options?: SecureStoreOptions) => string | null
export declare const configureDxEval: (token: string, scenario: string) => void
export declare const snapshotDxEval: (token: string) => {
  readonly writes: number
  readonly reads: number
  readonly deletes: number
  readonly operations: ReadonlyArray<"write" | "read" | "delete">
  readonly valuePresent: boolean
  readonly optionsMatched: boolean
}
