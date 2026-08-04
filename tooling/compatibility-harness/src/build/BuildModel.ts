import * as Data from "effect/Data"
import * as Schema from "effect/Schema"
import type { BuildRecord, Mode, ProcessObservation } from "../Domain.ts"

export interface BuildRequest {
  readonly id: string
  readonly mode: Mode
  readonly platform: "web" | "ios" | "android"
  readonly expoRevision: string
  readonly candidateRevision: string | null
  readonly timeoutMillis: number
  readonly probeSpecifier?: string
}

export interface BuildOutput {
  readonly record: BuildRecord
  readonly workspace: string
  readonly appDirectory: string
  readonly output: string
  readonly expoCli: string
  readonly observations: ReadonlyArray<ProcessObservation>
}

export interface BuildPairRequest {
  readonly materializationId: string
  readonly upstream: BuildRequest
  readonly candidate: BuildRequest
}

export interface BuildPairOutput {
  readonly upstream: BuildOutput
  readonly candidate: BuildOutput
}

export interface BuildImportRequest {
  readonly recordPath: string
  readonly binaryPath: string
  readonly platform: "ios" | "android"
}

export class BuildPipelineError extends Data.TaggedError("BuildPipelineError")<{
  readonly phase: "upstream" | "workspace" | "prebuild" | "build" | "evidence"
  readonly request: BuildRequest
  readonly cause: unknown
}> {}

export class BuildImportError extends Data.TaggedError("BuildImportError")<{
  readonly request: BuildImportRequest
  readonly cause: unknown
}> {}

export interface PinnedExpoToolchain {
  readonly root: string
  readonly nodeModules: string
  readonly artifacts: ReadonlyArray<BuildRecord["artifacts"][number]>
  readonly observations: ReadonlyArray<ProcessObservation>
  readonly performance: BuildRecord["performance"]
}

export const safeBuildId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const gitRevision = /^[0-9a-f]{40}$/

/** Packages whose source app plugins are evaluated by the compatibility app. */
export const pinnedPluginPackages = [
  "expo-router",
  "expo-video",
  "expo-background-fetch",
  "expo-background-task",
  "expo-font",
  "expo-notifications",
  "expo-location",
  "expo-tracking-transparency",
  "expo-web-browser",
  "expo-build-properties",
] as const

export const ProbeCatalog = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  probes: Schema.Array(
    Schema.Struct({ specifier: Schema.String, platforms: Schema.Array(Schema.String) }),
  ),
})

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
