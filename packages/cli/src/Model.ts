import * as Data from "effect/Data"

export const capabilityNames = ["keep-awake", "network", "secure-store", "battery"] as const
export const releaseVersion = "0.0.1-alpha.1"

export type CapabilityName = (typeof capabilityNames)[number]
export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun"

export interface Capability {
  readonly name: CapabilityName
  readonly provider: string
  readonly wrapper: string
  readonly wrapperVersion: string
  readonly effectVersion: string
  readonly importName: string
  readonly status: "effect"
}

// Generated release metadata is checked against compatibility/ownership.json and package manifests.
export const capabilities: Readonly<Record<CapabilityName, Capability>> = {
  network: {
    name: "network",
    provider: "expo-network",
    wrapper: "@better-native/network",
    wrapperVersion: releaseVersion,
    effectVersion: "4.0.0-rc.112",
    importName: "Network",
    status: "effect",
  },
  battery: {
    name: "battery",
    provider: "expo-battery",
    wrapper: "@better-native/battery",
    wrapperVersion: releaseVersion,
    effectVersion: "4.0.0-rc.112",
    importName: "Battery",
    status: "effect",
  },
  "keep-awake": {
    name: "keep-awake",
    provider: "expo-keep-awake",
    wrapper: "@better-native/keep-awake",
    wrapperVersion: releaseVersion,
    effectVersion: "4.0.0-rc.112",
    importName: "KeepAwake",
    status: "effect",
  },
  "secure-store": {
    name: "secure-store",
    provider: "expo-secure-store",
    wrapper: "@better-native/secure-store",
    wrapperVersion: releaseVersion,
    effectVersion: "4.0.0-rc.112",
    importName: "SecureStore",
    status: "effect",
  },
}

export class CliFailure extends Data.TaggedError("CliFailure")<{
  readonly responsibility: "project" | "package-manager" | "compatibility" | "expo" | "validation"
  readonly message: string
  readonly cause?: unknown
}> {}
