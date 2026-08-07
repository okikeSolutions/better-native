export declare const configureDxEval: (token: string, scenario: string) => void
export declare const snapshotDxEval: (token: string) => {
  readonly availabilityChecks: number
  readonly activations: number
  readonly deactivations: number
  readonly activatedTags: ReadonlyArray<string>
  readonly deactivatedTags: ReadonlyArray<string>
}
export declare const isAvailableAsync: () => Promise<boolean>
export declare const activateKeepAwakeAsync: (tag?: string) => Promise<void>
export declare const deactivateKeepAwake: (tag?: string) => Promise<void>
