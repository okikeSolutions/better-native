export declare enum BackgroundTaskStatus {
  Restricted = 1,
  Available = 2,
}
export declare enum BackgroundTaskResult {
  Success = 1,
  Failed = 2,
}
export interface BackgroundTaskOptions {
  readonly minimumInterval?: number
}
export declare const getStatusAsync: () => Promise<BackgroundTaskStatus>
export declare const registerTaskAsync: (
  name: string,
  options?: BackgroundTaskOptions,
) => Promise<void>
export declare const unregisterTaskAsync: (name: string) => Promise<void>
export declare const triggerTaskWorkerForTestingAsync: () => Promise<boolean>
export declare const addExpirationListener: (listener: () => void) => {
  readonly remove: () => void
}
