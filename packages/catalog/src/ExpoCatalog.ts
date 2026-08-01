import { NetworkCapability } from "./generated/NetworkCapability.ts"
import { ExpoPackages, ExpoProvenance } from "./generated/ExpoPackages.ts"

export type CoverageState = "complete" | "missing" | "not-applicable" | "unverified"

export interface OperationCoverage {
  readonly declaration: CoverageState
  readonly adapter: CoverageState
  readonly scenario: CoverageState
  readonly ios: CoverageState
  readonly android: CoverageState
  readonly web: CoverageState
  readonly agent: CoverageState
}

export interface ExpoOperation {
  readonly upstream: string
  readonly effect: string | null
  readonly kind: "effect" | "event-source" | "react-hook"
  readonly treatment: string
  readonly platforms: ReadonlyArray<"ios" | "android" | "web">
  readonly coverage: OperationCoverage
}

export interface ExpoCapability {
  readonly name: string
  readonly version: string
  readonly documentation: ReadonlyArray<string>
  readonly classification: string
  readonly operations: ReadonlyArray<ExpoOperation>
  readonly catalogStatus: "included" | "excluded"
  readonly catalogClassification: string
  readonly exclusionReason: string | null
  readonly sources: {
    readonly publicManifest: boolean
    readonly bundled: boolean
    readonly documented: boolean
  }
}

export const ExpoCatalog = {
  ...ExpoProvenance,
  packages: ExpoPackages.map(
    (entry): ExpoCapability =>
      entry.name === "expo-network"
        ? {
            name: entry.name,
            version: entry.version,
            documentation: entry.documentation,
            classification: NetworkCapability.classification,
            operations: NetworkCapability.operations,
            catalogStatus: entry.catalogStatus,
            catalogClassification: entry.catalogClassification,
            exclusionReason: entry.exclusionReason,
            sources: entry.sources
          }
        : {
            name: entry.name,
            version: entry.version,
            documentation: entry.documentation,
            classification: "unclassified",
            operations: [],
            catalogStatus: entry.catalogStatus,
            catalogClassification: entry.catalogClassification,
            exclusionReason: entry.exclusionReason,
            sources: entry.sources
          }
  )
} as const
