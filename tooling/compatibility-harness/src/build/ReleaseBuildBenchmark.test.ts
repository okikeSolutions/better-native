import { assert, describe, it } from "@effect/vitest"
import {
  profileBuildPhases,
  releaseBuildBudgetViolations,
  type ReleaseBuildBenchmarkResult,
} from "./ReleaseBuildBenchmark.ts"

const result = (overrides: Partial<ReleaseBuildBenchmarkResult> = {}) => ({
  schemaVersion: 2 as const,
  benchmarkId: "bench",
  platform: "ios" as const,
  sourceApp: "/cache/app",
  sourceHash: "source-hash",
  output: "/artifacts/app",
  outputHash: "output-hash",
  durationMillis: 40_000,
  runtimeRegistryBytes: 300_000,
  runtimeRegistryHash: "registry-hash",
  bundleBytes: 9_000_000,
  nativeCompilerInvocations: [],
  resourcePolicy: {
    profile: "polite" as const,
    workerCeiling: 2,
    cpuCeiling: 2,
    darwinScheduling: "utility-background",
    maxSimultaneousNativeBuilds: 1,
  },
  androidAbis: [],
  cache: {
    warmDecision: "repack" as const,
    coldDecision: "full-build" as const,
    hitReason: "validated native artifact was repacked",
    fallbackReason: "cache entry is missing",
  },
  coldBuild: {
    wallMillis: 100_000,
    accountedMillis: 90_000,
    unaccountedMillis: 10_000,
    phases: [
      { name: "native-prebuild.ndjson", durationMillis: 10_000, percentOfWall: 10 },
      { name: "xcode-release.ndjson", durationMillis: 70_000, percentOfWall: 70 },
      { name: "cocoapods-install.ndjson", durationMillis: 10_000, percentOfWall: 10 },
    ],
  },
  dependencies: {
    directRuntimeDependencies: 15,
    nativeRoots: 20,
    metroClosure: 716,
    autolinkedNativeModules: 19,
  },
  budgets: {
    durationMillis: 60_000,
    coldBuildMillis: 3_600_000,
    coldPhaseMillis: {
      "native-prebuild.ndjson": 600_000,
      "cocoapods-install.ndjson": 900_000,
      "xcode-release.ndjson": 2_700_000,
    },
    runtimeRegistryBytes: 409_600,
    workerCeiling: 2,
    cpuCeiling: 2,
    maxSimultaneousNativeBuilds: 1,
    expectedAndroidAbis: ["arm64-v8a"],
    dependencyMaxima: {
      directRuntimeDependencies: 15,
      nativeRoots: 20,
      metroClosure: 720,
      autolinkedNativeModules: 25,
    },
  },
  ...overrides,
})

describe("profileBuildPhases", () => {
  it("separates recorded phases from supervisor gaps", () => {
    assert.deepEqual(
      profileBuildPhases([
        { name: "pods", startedAtMillis: 0, finishedAtMillis: 20, durationMillis: 20 },
        { name: "xcode", startedAtMillis: 30, finishedAtMillis: 100, durationMillis: 70 },
      ]),
      {
        wallMillis: 100,
        accountedMillis: 90,
        unaccountedMillis: 10,
        phases: [
          { name: "xcode", durationMillis: 70, percentOfWall: 70 },
          { name: "pods", durationMillis: 20, percentOfWall: 20 },
        ],
      },
    )
  })
})

describe("releaseBuildBudgetViolations", () => {
  it("accepts a warm cached repack within both budgets", () => {
    assert.deepEqual(releaseBuildBudgetViolations(result()), [])
  })

  it("reports timing and runtime-registry regressions together", () => {
    assert.deepEqual(
      releaseBuildBudgetViolations(
        result({ durationMillis: 60_001, runtimeRegistryBytes: 409_601 }),
      ),
      [
        "warm ios repack took 60001ms (budget 60000ms)",
        "runtime registry is 409601 bytes (budget 409600 bytes)",
      ],
    )
  })

  it("rejects malformed measurements and budgets instead of comparing them as NaN", () => {
    assert.deepEqual(
      releaseBuildBudgetViolations(
        result({
          durationMillis: Number.NaN,
          runtimeRegistryBytes: -1,
          budgets: {
            ...result().budgets,
            durationMillis: 0,
            coldBuildMillis: 0,
            runtimeRegistryBytes: Number.POSITIVE_INFINITY,
          },
        }),
      ),
      [
        "warm repack duration budget must be a positive finite number",
        "runtime registry budget must be a positive finite number",
        "cold build duration budget must be a positive finite number",
        "warm repack duration must be a non-negative finite number",
        "runtime registry size must be a non-negative finite number",
      ],
    )
  })

  it("rejects native compilers, uncapped workers, excess CPU, and concurrent native builds", () => {
    assert.deepEqual(
      releaseBuildBudgetViolations(
        result({
          nativeCompilerInvocations: ["gradle"],
          resourcePolicy: {
            profile: "performance",
            workerCeiling: null,
            cpuCeiling: 8,
            darwinScheduling: null,
            maxSimultaneousNativeBuilds: 2,
          },
        }),
      ),
      [
        "warm cache hit invoked native compilers: gradle",
        "local worker ceiling is uncapped (budget 2)",
        "local CPU ceiling is 8 (budget 2)",
        "maximum simultaneous native builds is 2 (required 1)",
        "local benchmark used performance profile instead of polite",
        "local benchmark is missing utility/background process scheduling",
      ],
    )
  })

  it("enforces Android ABI, cache reasons, and cache decisions", () => {
    assert.deepEqual(
      releaseBuildBudgetViolations(
        result({
          platform: "android",
          androidAbis: ["arm64-v8a", "x86_64"],
          cache: {
            warmDecision: "full-build",
            coldDecision: "repack",
            hitReason: "",
            fallbackReason: "",
          },
          coldBuild: {
            wallMillis: 100_000,
            accountedMillis: 90_000,
            unaccountedMillis: 10_000,
            phases: [
              { name: "native-prebuild.ndjson", durationMillis: 10_000, percentOfWall: 10 },
              { name: "gradle-release.ndjson", durationMillis: 90_000, percentOfWall: 90 },
            ],
          },
          budgets: {
            ...result().budgets,
            coldPhaseMillis: {
              "native-prebuild.ndjson": 600_000,
              "gradle-release.ndjson": 2_100_000,
            },
          },
        }),
      ),
      [
        'Android ABI set is ["arm64-v8a","x86_64"] (expected ["arm64-v8a"])',
        "cache-hit reason is missing",
        "cache-fallback reason is missing",
        "warm cache record used full-build instead of repack",
        "cold cache record used repack instead of full-build",
      ],
    )
  })

  it("enforces cold-build timing and scoped dependency/autolink maxima", () => {
    assert.deepEqual(
      releaseBuildBudgetViolations(
        result({
          coldBuild: {
            wallMillis: 3_600_001,
            accountedMillis: 10,
            unaccountedMillis: 0,
            phases: [
              { name: "native-prebuild.ndjson", durationMillis: 5, percentOfWall: 0 },
              { name: "xcode-release.ndjson", durationMillis: 2_700_001, percentOfWall: 0 },
              { name: "cocoapods-install.ndjson", durationMillis: 5, percentOfWall: 0 },
              { name: "gradle-release.ndjson", durationMillis: -1, percentOfWall: 0 },
            ],
          },
          dependencies: {
            directRuntimeDependencies: 16,
            nativeRoots: 21,
            metroClosure: 721,
            autolinkedNativeModules: 26,
          },
        }),
      ),
      [
        "cold ios build took 3600001ms (budget 3600000ms)",
        "cold build phase xcode-release.ndjson took 2700001ms (budget 2700000ms)",
        "cold build phase gradle-release.ndjson has an invalid duration",
        "directRuntimeDependencies count is 16 (budget 15)",
        "nativeRoots count is 21 (budget 20)",
        "metroClosure count is 721 (budget 720)",
        "autolinkedNativeModules count is 26 (budget 25)",
      ],
    )
  })
})
