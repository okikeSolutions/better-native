export declare const configureDxEval: (token: string, scenario: string) => void
export declare const snapshotDxEval: (token: string) => {
  readonly registrations: number
  readonly removals: number
  readonly emitted: number
}
