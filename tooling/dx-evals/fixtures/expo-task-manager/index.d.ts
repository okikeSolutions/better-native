export type TaskManagerTaskBody<T = unknown> = {
  readonly data: T
  readonly error: { readonly code: string | number; readonly message: string } | null
  readonly executionInfo: { readonly eventId: string; readonly taskName: string }
}
export declare const defineTask: <T>(
  name: string,
  handler: (body: TaskManagerTaskBody<T>) => Promise<unknown>,
) => void
export declare const isTaskDefined: (name: string) => boolean
export declare const isAvailableAsync: () => Promise<boolean>
export declare const isTaskRegisteredAsync: (name: string) => Promise<boolean>
export declare const getTaskOptionsAsync: <A>(name: string) => Promise<A | null>
export declare const getRegisteredTasksAsync: () => Promise<ReadonlyArray<unknown>>
export declare const unregisterTaskAsync: (name: string) => Promise<void>
export declare const unregisterAllTasksAsync: () => Promise<void>
