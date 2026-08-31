import * as Data from "effect/Data"

export const capabilityNames = [
  "keep-awake",
  "network",
  "secure-store",
  "battery",
  "clipboard",
  "sqlite",
] as const
export const releaseVersion = "0.0.1-alpha.2"

export type CapabilityName = (typeof capabilityNames)[number]
export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun"

export const capabilityVersions: Readonly<Record<CapabilityName, string>> = {
  "keep-awake": "0.0.1-alpha.1",
  network: "0.0.1-alpha.1",
  "secure-store": "0.0.1-alpha.1",
  battery: "0.0.1-alpha.1",
  clipboard: "0.0.1-alpha.1",
  sqlite: "0.0.1-alpha.1",
}

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
    wrapperVersion: capabilityVersions.network,
    effectVersion: "4.0.0-rc.112",
    importName: "Network",
    status: "effect",
  },
  battery: {
    name: "battery",
    provider: "expo-battery",
    wrapper: "@better-native/battery",
    wrapperVersion: capabilityVersions.battery,
    effectVersion: "4.0.0-rc.112",
    importName: "Battery",
    status: "effect",
  },
  clipboard: {
    name: "clipboard",
    provider: "expo-clipboard",
    wrapper: "@better-native/clipboard",
    wrapperVersion: capabilityVersions.clipboard,
    effectVersion: "4.0.0-rc.112",
    importName: "Clipboard",
    status: "effect",
  },
  sqlite: {
    name: "sqlite",
    provider: "expo-sqlite",
    wrapper: "@better-native/sqlite",
    wrapperVersion: capabilityVersions.sqlite,
    effectVersion: "4.0.0-rc.112",
    importName: "SQLite",
    status: "effect",
  },
  "keep-awake": {
    name: "keep-awake",
    provider: "expo-keep-awake",
    wrapper: "@better-native/keep-awake",
    wrapperVersion: capabilityVersions["keep-awake"],
    effectVersion: "4.0.0-rc.112",
    importName: "KeepAwake",
    status: "effect",
  },
  "secure-store": {
    name: "secure-store",
    provider: "expo-secure-store",
    wrapper: "@better-native/secure-store",
    wrapperVersion: capabilityVersions["secure-store"],
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
