/** Checked-in performance budgets for the cached local Release path. */
export interface ReleaseBuildBudgets {
  readonly schemaVersion: 2
  readonly runtimeRegistryMaxBytes: number
  readonly warmRepackMaxMillis: Readonly<Record<"ios" | "android", number>>
  readonly coldBuildMaxMillis: Readonly<Record<"ios" | "android", number>>
  readonly coldPhaseMaxMillis: Readonly<Record<"ios" | "android", Readonly<Record<string, number>>>>
  readonly localWorkerCeiling: number
  readonly localCpuCeiling: number
  readonly maxSimultaneousNativeBuilds: 1
  readonly expectedAndroidAbis: ReadonlyArray<string>
  readonly dependencyMaxima: {
    readonly directRuntimeDependencies: number
    readonly nativeRoots: number
    readonly metroClosure: number
    readonly autolinkedNativeModules: number
  }
}

/** Machine-readable result emitted by the Release build benchmark. */
export interface ReleaseBuildBenchmarkResult {
  readonly schemaVersion: 2
  readonly benchmarkId: string
  readonly platform: "ios" | "android"
  readonly sourceApp: string
  readonly sourceHash: string
  readonly output: string
  readonly outputHash: string
  readonly durationMillis: number
  readonly runtimeRegistryBytes: number
  readonly runtimeRegistryHash: string
  readonly bundleBytes: number | null
  readonly nativeCompilerInvocations: ReadonlyArray<string>
  readonly resourcePolicy: {
    readonly profile: "polite" | "performance"
    readonly workerCeiling: number | null
    readonly cpuCeiling: number | null
    readonly darwinScheduling: string | null
    readonly maxSimultaneousNativeBuilds: number
  }
  readonly androidAbis: ReadonlyArray<string>
  readonly cache: {
    readonly warmDecision: "bundle" | "full-build" | "repack"
    readonly coldDecision: "bundle" | "full-build" | "repack"
    readonly hitReason: string
    readonly fallbackReason: string
  }
  readonly coldBuild: BuildRecordProfile
  readonly dependencies: {
    readonly directRuntimeDependencies: number
    readonly nativeRoots: number
    readonly metroClosure: number
    readonly autolinkedNativeModules: number
  }
  readonly budgets: {
    readonly durationMillis: number
    readonly coldBuildMillis: number
    readonly coldPhaseMillis: Readonly<Record<string, number>>
    readonly runtimeRegistryBytes: number
    readonly workerCeiling: number
    readonly cpuCeiling: number
    readonly maxSimultaneousNativeBuilds: number
    readonly expectedAndroidAbis: ReadonlyArray<string>
    readonly dependencyMaxima: ReleaseBuildBudgets["dependencyMaxima"]
  }
}

/** Returns stable, user-facing budget violations for a benchmark result. */
export const releaseBuildBudgetViolations = (
  result: ReleaseBuildBenchmarkResult,
): ReadonlyArray<string> => {
  const violations: Array<string> = []
  if (!Number.isFinite(result.budgets.durationMillis) || result.budgets.durationMillis <= 0) {
    violations.push("warm repack duration budget must be a positive finite number")
  }
  if (
    !Number.isFinite(result.budgets.runtimeRegistryBytes) ||
    result.budgets.runtimeRegistryBytes <= 0
  ) {
    violations.push("runtime registry budget must be a positive finite number")
  }
  if (!Number.isFinite(result.budgets.coldBuildMillis) || result.budgets.coldBuildMillis <= 0) {
    violations.push("cold build duration budget must be a positive finite number")
  }
  if (!Number.isFinite(result.durationMillis) || result.durationMillis < 0) {
    violations.push("warm repack duration must be a non-negative finite number")
  }
  if (!Number.isFinite(result.runtimeRegistryBytes) || result.runtimeRegistryBytes < 0) {
    violations.push("runtime registry size must be a non-negative finite number")
  }
  if (result.nativeCompilerInvocations.length > 0) {
    violations.push(
      `warm cache hit invoked native compilers: ${result.nativeCompilerInvocations.join(", ")}`,
    )
  }
  if (
    result.resourcePolicy.workerCeiling === null ||
    result.resourcePolicy.workerCeiling > result.budgets.workerCeiling
  ) {
    violations.push(
      `local worker ceiling is ${result.resourcePolicy.workerCeiling ?? "uncapped"} (budget ${result.budgets.workerCeiling})`,
    )
  }
  if (
    result.resourcePolicy.cpuCeiling === null ||
    result.resourcePolicy.cpuCeiling > result.budgets.cpuCeiling
  ) {
    violations.push(
      `local CPU ceiling is ${result.resourcePolicy.cpuCeiling ?? "uncapped"} (budget ${result.budgets.cpuCeiling})`,
    )
  }
  if (
    result.resourcePolicy.maxSimultaneousNativeBuilds !== result.budgets.maxSimultaneousNativeBuilds
  ) {
    violations.push(
      `maximum simultaneous native builds is ${result.resourcePolicy.maxSimultaneousNativeBuilds} (required ${result.budgets.maxSimultaneousNativeBuilds})`,
    )
  }
  if (result.resourcePolicy.profile !== "polite") {
    violations.push(
      `local benchmark used ${result.resourcePolicy.profile} profile instead of polite`,
    )
  }
  if (result.resourcePolicy.darwinScheduling !== "utility-background") {
    violations.push("local benchmark is missing utility/background process scheduling")
  }
  if (
    result.platform === "android" &&
    JSON.stringify([...result.androidAbis].toSorted()) !==
      JSON.stringify([...result.budgets.expectedAndroidAbis].toSorted())
  ) {
    violations.push(
      `Android ABI set is ${JSON.stringify(result.androidAbis)} (expected ${JSON.stringify(result.budgets.expectedAndroidAbis)})`,
    )
  }
  if (result.cache.hitReason.trim().length === 0) violations.push("cache-hit reason is missing")
  if (result.cache.fallbackReason.trim().length === 0)
    violations.push("cache-fallback reason is missing")
  if (result.cache.warmDecision !== "repack") {
    violations.push(`warm cache record used ${result.cache.warmDecision} instead of repack`)
  }
  if (result.cache.coldDecision !== "full-build") {
    violations.push(`cold cache record used ${result.cache.coldDecision} instead of full-build`)
  }
  if (
    Number.isFinite(result.budgets.coldBuildMillis) &&
    result.budgets.coldBuildMillis > 0 &&
    result.coldBuild.wallMillis > result.budgets.coldBuildMillis
  ) {
    violations.push(
      `cold ${result.platform} build took ${result.coldBuild.wallMillis}ms (budget ${result.budgets.coldBuildMillis}ms)`,
    )
  }
  if (result.coldBuild.phases.length === 0) violations.push("cold build has no recorded phases")
  const coldPhases = new Map(result.coldBuild.phases.map((phase) => [phase.name, phase]))
  for (const [required, maximum] of Object.entries(result.budgets.coldPhaseMillis)) {
    const phase = coldPhases.get(required)
    if (phase === undefined) {
      violations.push(`cold build phase ${required} is missing`)
    } else if (phase.durationMillis > maximum) {
      violations.push(
        `cold build phase ${required} took ${phase.durationMillis}ms (budget ${maximum}ms)`,
      )
    }
  }
  for (const phase of result.coldBuild.phases) {
    if (!Number.isFinite(phase.durationMillis) || phase.durationMillis < 0) {
      violations.push(`cold build phase ${phase.name} has an invalid duration`)
    }
  }
  for (const name of Object.keys(result.dependencies) as Array<keyof typeof result.dependencies>) {
    const actual = result.dependencies[name]
    const maximum = result.budgets.dependencyMaxima[name]
    if (!Number.isSafeInteger(actual) || actual < 0) {
      violations.push(`${name} count must be a non-negative integer`)
    } else if (actual > maximum) {
      violations.push(`${name} count is ${actual} (budget ${maximum})`)
    }
  }
  if (result.durationMillis > result.budgets.durationMillis) {
    violations.push(
      `warm ${result.platform} repack took ${result.durationMillis}ms (budget ${result.budgets.durationMillis}ms)`,
    )
  }
  if (result.runtimeRegistryBytes > result.budgets.runtimeRegistryBytes) {
    violations.push(
      `runtime registry is ${result.runtimeRegistryBytes} bytes (budget ${result.budgets.runtimeRegistryBytes} bytes)`,
    )
  }
  return violations
}

export interface BuildRecordProfile {
  readonly wallMillis: number
  readonly accountedMillis: number
  readonly unaccountedMillis: number
  readonly phases: ReadonlyArray<{
    readonly name: string
    readonly durationMillis: number
    readonly percentOfWall: number
  }>
}

/** Converts persisted phase evidence into a descending wall-time profile. */
export const profileBuildPhases = (
  phases: ReadonlyArray<{
    readonly name: string
    readonly startedAtMillis: number
    readonly finishedAtMillis: number
    readonly durationMillis: number
  }>,
): BuildRecordProfile => {
  if (phases.length === 0) {
    return { wallMillis: 0, accountedMillis: 0, unaccountedMillis: 0, phases: [] }
  }
  const startedAtMillis = Math.min(...phases.map((phase) => phase.startedAtMillis))
  const finishedAtMillis = Math.max(...phases.map((phase) => phase.finishedAtMillis))
  const wallMillis = finishedAtMillis - startedAtMillis
  const accountedMillis = phases.reduce((total, phase) => total + phase.durationMillis, 0)
  return {
    wallMillis,
    accountedMillis,
    unaccountedMillis: Math.max(0, wallMillis - accountedMillis),
    phases: phases
      .map(({ name, durationMillis }) => ({
        name,
        durationMillis,
        percentOfWall: wallMillis === 0 ? 0 : (durationMillis / wallMillis) * 100,
      }))
      .toSorted((left, right) => right.durationMillis - left.durationMillis),
  }
}
