import type { ReactNode } from "react"
import { metadata as generatedMetadata } from "./generated/RegistryMetadata"
import { loaders } from "./generated/RegistryLoaders"

let authoritativeNames: ReadonlySet<string> | null = null

/** Initialized once by the app-only adapter before any compatibility route runs. */
export const configureUpstreamSelection = (names: ReadonlyArray<string>): void => {
  authoritativeNames = new Set(names)
}

export interface ExpoTestModule {
  readonly name: string
  readonly test: (jasmine: unknown, tools: TestTools) => void | Promise<void>
}

export interface TestTools {
  readonly setPortalChild: (child: ReactNode) => void
  readonly cleanupPortal: () => Promise<void>
  readonly setProgress: (progress: RunnerProgress) => void
}

export interface RunnerProgress {
  readonly runId: string
  readonly sourceId: string
  readonly phase: "loading" | "registering" | "running" | "spec-finished" | "complete"
  readonly caseId: string | null
}

export type RegistryLoaders = ReadonlyMap<string, () => unknown>

export const metadata = generatedMetadata
export const nativeE2eSourceIds: ReadonlySet<string> = new Set(metadata.nativeE2eSourceIds)
const interactiveSmokePaths = new Set([
  "apps/test-suite/tests/Basic.js",
  "apps/test-suite/tests/Battery.js",
  "apps/test-suite/tests/Network.js",
])
/** Pinned Expo modules exercised by the app's default interactive run. */
export const interactiveSmokeSourceIds: ReadonlySet<string> = new Set(
  metadata.sources
    .filter(({ path }) => interactiveSmokePaths.has(path))
    .map(({ sourceId }) => sourceId),
)
export const registry = metadata.sources.map((source) => ({
  ...source,
  load: loaders.get(source.sourceId) ?? null,
  reason:
    source.reason ??
    (loaders.has(source.sourceId) ? null : "source is not selected for this platform"),
  get selectedByUpstream() {
    if (source.authority === "supplemental") return true
    if (authoritativeNames === null) {
      throw new Error("Pinned Expo TestModules applicability was read before app initialization")
    }
    return source.runtimeName !== null && authoritativeNames.has(source.runtimeName)
  },
}))

export type RegistryEntry = (typeof registry)[number]
