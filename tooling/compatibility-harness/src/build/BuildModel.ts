import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { BuildId, BuildRecord, Mode, ProcessObservation } from "../Domain.ts"

/** Inputs required to build one upstream or candidate compatibility app. */
export interface BuildRequest {
  readonly id: BuildId
  readonly mode: Mode
  readonly platform: "web" | "ios" | "android"
  readonly expoRevision: string
  readonly candidateRevision: string | null
  readonly timeoutMillis: number
  readonly probeSpecifier?: string
  /** Optional supplemental source used to build a minimal capability-native shell. */
  readonly capabilitySource?: string
  /** Explicitly authorizes a full native compile after a cached artifact fails to repack. */
  readonly allowNativeRebuild?: boolean
}

/** Build result, workspace paths, command output, and immutable evidence. */
export interface BuildOutput {
  readonly record: BuildRecord
  readonly workspace: string
  readonly appDirectory: string
  readonly output: string
  readonly expoCli: string
  readonly observations: ReadonlyArray<ProcessObservation>
}

/** Two builds sharing one pinned Expo materialization. */
export interface BuildPairRequest {
  readonly materializationId: BuildId
  readonly upstream: BuildRequest
  readonly candidate: BuildRequest
}

/** Paired upstream and candidate build outputs. */
export interface BuildPairOutput {
  readonly upstream: BuildOutput
  readonly candidate: BuildOutput
}

/** Request to import and validate a native build produced elsewhere. */
export interface BuildImportRequest {
  readonly recordPath: string
  readonly binaryPath: string
  readonly platform: "ios" | "android"
}

/** Failure raised during toolchain preparation, workspace creation, or building. */
export class BuildPipelineError extends Data.TaggedError("BuildPipelineError")<{
  readonly phase: "upstream" | "workspace" | "prebuild" | "build" | "evidence"
  readonly request: BuildRequest
  readonly cause: unknown
}> {}

/**
 * Stops a failed native repack from silently escalating into an expensive compile.
 *
 * @param request - Build request containing the caller's rebuild authorization.
 * @param restore - Native-cache result and its structured repack-failure state.
 * @returns An effect that succeeds unless an unauthorized native rebuild would occur.
 */
export const ensureNativeRebuildAllowed = (
  request: BuildRequest,
  restore: { readonly repackFailure: boolean; readonly reason: string },
): Effect.Effect<void, BuildPipelineError> =>
  restore.repackFailure && request.allowNativeRebuild !== true
    ? Effect.fail(
        new BuildPipelineError({
          phase: "build",
          request,
          cause: `${restore.reason}. A full native build was not started. Re-run with --allow-native-rebuild to explicitly authorize Gradle, CocoaPods, or Xcode compilation.`,
        }),
      )
    : Effect.void

/** Failure raised when an imported native product does not match its record. */
export class BuildImportError extends Data.TaggedError("BuildImportError")<{
  readonly request: BuildImportRequest
  readonly cause: unknown
}> {}

/** Prepared pinned Expo installation reused by one or more builds. */
export interface PinnedExpoToolchain {
  readonly root: string
  readonly nodeModules: string
  readonly artifacts: ReadonlyArray<BuildRecord["artifacts"][number]>
  readonly observations: ReadonlyArray<ProcessObservation>
  readonly performance: BuildRecord["performance"]
}

/** Matches the full lowercase Git revision required by the harness protocol. */
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

/** Versioned catalog of isolated web resolution probes. */
export const ProbeCatalog = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  probes: Schema.Array(
    Schema.Struct({ specifier: Schema.String, platforms: Schema.Array(Schema.String) }),
  ),
})

/**
 * Narrows decoded JSON to a non-array object record.
 *
 * @param value - Unknown value to inspect.
 * @returns Whether the value is a non-null, non-array object.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
