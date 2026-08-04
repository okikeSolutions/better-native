import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { ProcessObservation } from "../Domain.ts"
import type { PreparedAppWorkspace } from "./AppWorkspace.ts"

export class NativeResolutionError extends Data.TaggedError("NativeResolutionError")<{
  readonly cause: unknown
}> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stdoutJson = (observations: ReadonlyArray<ProcessObservation>): unknown => {
  const output = observations
    .filter(({ stream }) => stream === "stdout")
    .map(({ text }) => text)
    .join("\n")
  return JSON.parse(output) as unknown
}

const normalized = (value: string): string => value.replaceAll("\\", "/").replace(/\/$/, "")

const isWithin = (root: string, candidate: string): boolean => {
  const expected = normalized(root)
  const actual = normalized(candidate)
  return actual === expected || actual.startsWith(`${expected}/`)
}

const expectedRoots = (workspace: PreparedAppWorkspace): ReadonlyMap<string, string> =>
  new Map([
    ...workspace.pinnedExpoPackages.map(({ name, source }) => [name, source] as const),
    ...workspace.dependencyResolutions.map(({ name, source }) => [name, source] as const),
  ])

const assertPath = (
  roots: ReadonlyMap<string, string>,
  packageName: string,
  candidate: unknown,
): void => {
  if (typeof candidate !== "string") {
    throw new Error(`native resolution for ${packageName} has no package path`)
  }
  const expected = roots.get(packageName)
  if (expected === undefined) {
    throw new Error(`native resolution contains undeclared package ${packageName}`)
  }
  if (!isWithin(expected, candidate)) {
    throw new Error(`${packageName} resolved to ${candidate}; expected materialization ${expected}`)
  }
}

const validateExpoModules = (
  roots: ReadonlyMap<string, string>,
  observations: ReadonlyArray<ProcessObservation>,
): void => {
  const decoded = stdoutJson(observations)
  if (!isRecord(decoded) || !Array.isArray(decoded.modules)) {
    throw new Error("invalid Expo Autolinking resolve output")
  }
  for (const entry of decoded.modules) {
    if (!isRecord(entry) || typeof entry.packageName !== "string") {
      throw new Error("invalid Expo Autolinking module entry")
    }
    const candidates: Array<unknown> = []
    if (Array.isArray(entry.pods)) {
      candidates.push(...entry.pods.map((pod) => (isRecord(pod) ? pod.podspecDir : undefined)))
    }
    if (Array.isArray(entry.projects)) {
      candidates.push(
        ...entry.projects.map((project) => (isRecord(project) ? project.sourceDir : undefined)),
      )
    }
    if (Array.isArray(entry.plugins)) {
      candidates.push(
        ...entry.plugins.map((plugin) => (isRecord(plugin) ? plugin.sourceDir : undefined)),
      )
    }
    if (candidates.length === 0) {
      throw new Error(`Expo Autolinking returned no native path for ${entry.packageName}`)
    }
    for (const candidate of candidates) assertPath(roots, entry.packageName, candidate)
  }
}

export const discoverNativeExpoPackages = (
  observations: ReadonlyArray<ProcessObservation>,
): Effect.Effect<ReadonlyArray<string>, NativeResolutionError> =>
  Effect.try({
    try: () => {
      const decoded = stdoutJson(observations)
      if (!isRecord(decoded) || !Array.isArray(decoded.modules)) {
        throw new Error("invalid Expo Autolinking discovery output")
      }
      return [
        ...new Set(
          decoded.modules.map((entry) => {
            if (!isRecord(entry) || typeof entry.packageName !== "string") {
              throw new Error("invalid Expo Autolinking discovery entry")
            }
            return entry.packageName
          }),
        ),
      ].toSorted()
    },
    catch: (cause) => new NativeResolutionError({ cause }),
  })

const validateReactNativeModules = (
  roots: ReadonlyMap<string, string>,
  observations: ReadonlyArray<ProcessObservation>,
): void => {
  const decoded = stdoutJson(observations)
  if (!isRecord(decoded) || !isRecord(decoded.dependencies)) {
    throw new Error("invalid React Native Autolinking output")
  }
  for (const [packageName, entry] of Object.entries(decoded.dependencies)) {
    if (!isRecord(entry)) throw new Error(`invalid React Native module entry for ${packageName}`)
    if (!roots.has(packageName)) continue
    assertPath(roots, packageName, entry.root)
  }
}

export const validateNativeResolution = (options: {
  readonly workspace: PreparedAppWorkspace
  readonly expoModules: ReadonlyArray<ProcessObservation>
  readonly reactNativeModules: ReadonlyArray<ProcessObservation>
}): Effect.Effect<void, NativeResolutionError> =>
  Effect.try({
    try: () => {
      const roots = expectedRoots(options.workspace)
      validateExpoModules(roots, options.expoModules)
      validateReactNativeModules(roots, options.reactNativeModules)
    },
    catch: (cause) => new NativeResolutionError({ cause }),
  })
