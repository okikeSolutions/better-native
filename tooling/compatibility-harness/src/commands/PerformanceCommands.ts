import { fileURLToPath } from "node:url"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as Clock from "effect/Clock"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import { BuildRecord } from "../Domain.ts"
import { HarnessError } from "../HarnessError.ts"
import { HarnessConfig } from "../HarnessConfig.ts"
import {
  profileBuildPhases,
  releaseBuildBudgetViolations,
  type ReleaseBuildBenchmarkResult,
  type ReleaseBuildBudgets,
} from "../build/ReleaseBuildBenchmark.ts"
import { applyBuildProfile, buildProfileEnvironment } from "../build/BuildProfile.ts"
import { ProcessSupervisor } from "../supervision/ProcessSupervisor.ts"
import { BuildProducts } from "../build/BuildProducts.ts"
import { buildIdFlag, nativePlatform, timeoutMillisFlag } from "./Shared.ts"

const sourceAppFlag = Flag.string("source-app")
const recordFlag = Flag.string("record")
const cacheHitRecordFlag = Flag.string("cache-hit-record")
const coldBuildRecordFlag = Flag.string("cold-build-record")
const repackModulePath = fileURLToPath(import.meta.resolve("@expo/repack-app"))

const PositiveFinite = Schema.Finite.check(Schema.isGreaterThan(0))
const ReleaseBuildBudgetsSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  runtimeRegistryMaxBytes: PositiveFinite,
  warmRepackMaxMillis: Schema.Struct({ ios: PositiveFinite, android: PositiveFinite }),
  coldBuildMaxMillis: Schema.Struct({ ios: PositiveFinite, android: PositiveFinite }),
  coldPhaseMaxMillis: Schema.Struct({
    ios: Schema.Struct({
      "native-prebuild.ndjson": PositiveFinite,
      "cocoapods-install.ndjson": PositiveFinite,
      "xcode-release.ndjson": PositiveFinite,
    }),
    android: Schema.Struct({
      "native-prebuild.ndjson": PositiveFinite,
      "gradle-release.ndjson": PositiveFinite,
    }),
  }),
  localWorkerCeiling: PositiveFinite,
  localCpuCeiling: PositiveFinite,
  maxSimultaneousNativeBuilds: Schema.Literal(1),
  expectedAndroidAbis: Schema.Array(Schema.NonEmptyString),
  dependencyMaxima: Schema.Struct({
    directRuntimeDependencies: PositiveFinite,
    nativeRoots: PositiveFinite,
    metroClosure: PositiveFinite,
    autolinkedNativeModules: PositiveFinite,
  }),
})

const io = <A>(operation: string, target: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new HarnessError({ operation, path: target, cause }),
  })

/** Benchmarks the cache-hit path without compiling native sources. */
export const benchmarkReleasePath = Command.make(
  "benchmark-release-path",
  {
    platform: nativePlatform,
    benchmarkId: buildIdFlag,
    sourceApp: sourceAppFlag,
    cacheHitRecord: cacheHitRecordFlag,
    coldBuildRecord: coldBuildRecordFlag,
    timeoutMillis: timeoutMillisFlag,
  },
  Effect.fn("Command.benchmarkReleasePath")(function* ({
    platform,
    benchmarkId,
    sourceApp: sourceAppPath,
    cacheHitRecord: cacheHitRecordPath,
    coldBuildRecord: coldBuildRecordPath,
    timeoutMillis,
  }) {
    const processes = yield* ProcessSupervisor
    const products = yield* BuildProducts
    const config = yield* HarnessConfig
    const root = process.cwd()
    const source = path.resolve(root, sourceAppPath)
    const benchmarkDirectory = path.join(root, ".artifacts", "benchmarks", benchmarkId)
    const output = path.join(
      benchmarkDirectory,
      platform === "ios" ? "BetterNativeCompatibility.app" : "app-release.apk",
    )
    const budgetsPath = path.join(root, "compatibility", "release-build-budgets.json")
    const cacheHitRecordTarget = path.resolve(root, cacheHitRecordPath)
    const coldBuildRecordTarget = path.resolve(root, coldBuildRecordPath)
    const registryPath = path.join(
      root,
      "apps",
      "compatibility-suite",
      "src",
      "generated",
      `RuntimeRegistryMetadata.${platform}.ts`,
    )
    const sourceStat = yield* io("inspect benchmark source", source, () => fs.stat(source))
    if (platform === "ios" && !sourceStat.isDirectory()) {
      return yield* new HarnessError({
        operation: "validate benchmark source",
        path: source,
        cause: "iOS source-app must be an .app directory",
      })
    }
    yield* io("create benchmark directory", benchmarkDirectory, async () => {
      await fs.mkdir(path.dirname(benchmarkDirectory), { recursive: true })
      await fs.mkdir(benchmarkDirectory)
    })
    const rawBudgets = yield* io("read Release build budgets", budgetsPath, async () =>
      JSON.parse(await fs.readFile(budgetsPath, "utf8")),
    )
    const budgets: ReleaseBuildBudgets = yield* Schema.decodeUnknownEffect(
      ReleaseBuildBudgetsSchema,
    )(rawBudgets).pipe(
      Effect.mapError(
        (cause) =>
          new HarnessError({
            operation: "validate Release build budgets",
            path: budgetsPath,
            cause,
          }),
      ),
    )
    const readBuildRecord = (target: string) =>
      io("read Release build record", target, async () =>
        JSON.parse(await fs.readFile(target, "utf8")),
      ).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(BuildRecord)),
        Effect.mapError(
          (cause) =>
            new HarnessError({ operation: "validate Release build record", path: target, cause }),
        ),
      )
    const [cacheHitRecord, coldBuildRecord] = yield* Effect.all([
      readBuildRecord(cacheHitRecordTarget),
      readBuildRecord(coldBuildRecordTarget),
    ])
    if (cacheHitRecord.platform !== platform || coldBuildRecord.platform !== platform) {
      return yield* new HarnessError({
        operation: "validate Release benchmark platforms",
        cause: `benchmark is ${platform}, cache-hit record is ${cacheHitRecord.platform}, cold record is ${coldBuildRecord.platform}`,
      })
    }
    if (
      cacheHitRecord.expoRevision !== coldBuildRecord.expoRevision ||
      cacheHitRecord.capabilitySource !== coldBuildRecord.capabilitySource ||
      cacheHitRecord.nativeFingerprint === null ||
      cacheHitRecord.nativeFingerprint !== coldBuildRecord.nativeFingerprint ||
      cacheHitRecord.toolchainFingerprint === null ||
      cacheHitRecord.toolchainFingerprint !== coldBuildRecord.toolchainFingerprint
    ) {
      return yield* new HarnessError({
        operation: "validate Release benchmark provenance",
        cause:
          "cache-hit and cold-build records must describe the same Expo revision, capability shell, native closure, and toolchain",
      })
    }
    const registryStat = yield* io("inspect runtime registry", registryPath, () =>
      fs.stat(registryPath),
    )
    const sourceHash = yield* products
      .hash(source)
      .pipe(
        Effect.mapError(
          (cause) => new HarnessError({ operation: "hash benchmark source", path: source, cause }),
        ),
      )
    const runtimeRegistryHash = yield* products
      .hash(registryPath)
      .pipe(
        Effect.mapError(
          (cause) =>
            new HarnessError({ operation: "hash runtime registry", path: registryPath, cause }),
        ),
      )
    if (cacheHitRecord.nativeBinaryHash !== sourceHash) {
      return yield* new HarnessError({
        operation: "validate benchmark source provenance",
        path: source,
        cause: `source hash ${sourceHash} does not match cache-hit build ${cacheHitRecord.id} (${cacheHitRecord.nativeBinaryHash})`,
      })
    }
    const startedAtMillis = yield* Clock.currentTimeMillis
    const run = yield* processes.run(
      applyBuildProfile(config.buildProfile, "metro-wrapper", {
        command: "node",
        args: [
          path.join(path.dirname(repackModulePath), "..", "bin", "cli.js"),
          "--platform",
          platform,
          "--source-app",
          source,
          "--working-directory",
          path.join(benchmarkDirectory, "work"),
          "--output",
          output,
          "--js-bundle-only",
          path.join(root, "apps", "compatibility-suite"),
        ],
        cwd: root,
        env: {
          ...buildProfileEnvironment(config.buildProfile),
          NODE_ENV: "production",
          BETTER_NATIVE_MODE: "candidate",
          BETTER_NATIVE_BUILD_ID: benchmarkId,
        },
        timeoutMillis,
        retainedOutputBytes: 512 * 1024,
        retainedOutputLines: 2_000,
      }),
    )
    if (run.exitCode !== 0) {
      return yield* new HarnessError({
        operation: "benchmark cached Release repack",
        path: source,
        cause: run.observations
          .slice(-30)
          .map(({ text }) => text)
          .join("\n"),
      })
    }
    const finishedAtMillis = yield* Clock.currentTimeMillis
    const bundlePath = path.join(output, "main.jsbundle")
    const bundleBytes =
      platform === "ios"
        ? yield* io("inspect benchmark bundle", bundlePath, () => fs.stat(bundlePath)).pipe(
            Effect.map(({ size }) => size),
          )
        : null
    const outputHash = yield* products
      .hash(output)
      .pipe(
        Effect.mapError(
          (cause) => new HarnessError({ operation: "hash benchmark output", path: output, cause }),
        ),
      )
    const policy = cacheHitRecord.performance.policy
    const coldPolicy = coldBuildRecord.performance.policy
    const dependencies = cacheHitRecord.performance.dependencyCounts
    const coldDependencies = coldBuildRecord.performance.dependencyCounts
    const cacheHit = cacheHitRecord.performance.caches.find(
      ({ name }) => name === "native-artifact",
    )
    const cacheFallback = coldBuildRecord.performance.caches.find(
      ({ name }) => name === "native-artifact",
    )
    const coldBuild = profileBuildPhases(
      coldBuildRecord.performance.phases.filter(({ name }) => !name.startsWith("upstream-")),
    )
    const result: ReleaseBuildBenchmarkResult = {
      schemaVersion: 2,
      benchmarkId,
      platform,
      sourceApp: source,
      sourceHash,
      output,
      outputHash,
      durationMillis: finishedAtMillis - startedAtMillis,
      runtimeRegistryBytes: registryStat.size,
      runtimeRegistryHash,
      bundleBytes,
      nativeCompilerInvocations: cacheHitRecord.performance.nativeCompilerInvocations ?? [
        "unrecorded",
      ],
      resourcePolicy:
        policy === undefined || coldPolicy === undefined
          ? {
              profile: "performance",
              workerCeiling: null,
              cpuCeiling: null,
              darwinScheduling: null,
              maxSimultaneousNativeBuilds: 0,
            }
          : {
              profile:
                policy.profile === "polite" && coldPolicy.profile === "polite"
                  ? "polite"
                  : "performance",
              workerCeiling:
                policy.workerCeiling === null || coldPolicy.workerCeiling === null
                  ? null
                  : Math.max(policy.workerCeiling, coldPolicy.workerCeiling),
              cpuCeiling:
                policy.cpuCeiling === null || coldPolicy.cpuCeiling === null
                  ? null
                  : Math.max(policy.cpuCeiling, coldPolicy.cpuCeiling),
              darwinScheduling:
                policy.darwinScheduling === "utility-background" &&
                coldPolicy.darwinScheduling === "utility-background"
                  ? "utility-background"
                  : null,
              maxSimultaneousNativeBuilds: Math.max(
                policy.maxSimultaneousNativeBuilds,
                coldPolicy.maxSimultaneousNativeBuilds,
              ),
            },
      androidAbis: coldPolicy?.androidAbis ?? [],
      cache: {
        warmDecision: cacheHitRecord.buildDecision,
        coldDecision: coldBuildRecord.buildDecision,
        hitReason: cacheHit?.status === "hit" ? (cacheHit.detail ?? "") : "",
        fallbackReason: cacheFallback?.status === "miss" ? (cacheFallback.detail ?? "") : "",
      },
      coldBuild,
      dependencies:
        dependencies === undefined || coldDependencies === undefined
          ? {
              directRuntimeDependencies: -1,
              nativeRoots: -1,
              metroClosure: -1,
              autolinkedNativeModules: -1,
            }
          : {
              directRuntimeDependencies: Math.max(
                dependencies.directRuntimeDependencies,
                coldDependencies.directRuntimeDependencies,
              ),
              nativeRoots: Math.max(dependencies.nativeRoots, coldDependencies.nativeRoots),
              metroClosure: Math.max(dependencies.metroClosure, coldDependencies.metroClosure),
              autolinkedNativeModules: Math.max(
                dependencies.autolinkedNativeModules,
                coldDependencies.autolinkedNativeModules,
              ),
            },
      budgets: {
        durationMillis: budgets.warmRepackMaxMillis[platform],
        coldBuildMillis: budgets.coldBuildMaxMillis[platform],
        coldPhaseMillis: budgets.coldPhaseMaxMillis[platform],
        runtimeRegistryBytes: budgets.runtimeRegistryMaxBytes,
        workerCeiling: budgets.localWorkerCeiling,
        cpuCeiling: budgets.localCpuCeiling,
        maxSimultaneousNativeBuilds: budgets.maxSimultaneousNativeBuilds,
        expectedAndroidAbis: budgets.expectedAndroidAbis,
        dependencyMaxima: budgets.dependencyMaxima,
      },
    }
    const resultPath = path.join(benchmarkDirectory, "result.json")
    yield* io("write Release build benchmark", resultPath, () =>
      fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`),
    )
    yield* Console.log(JSON.stringify(result, null, 2))
    const violations = releaseBuildBudgetViolations(result)
    if (violations.length > 0) {
      return yield* new HarnessError({
        operation: "enforce Release build performance budgets",
        path: resultPath,
        cause: violations.join("; "),
      })
    }
  }),
).pipe(
  Command.withDescription(
    "Benchmark a provenance-bound cache-hit repack and enforce Release-path resource budgets",
  ),
)

/** Prints a compact phase/cache profile from an immutable build record. */
export const profileBuildRecord = Command.make(
  "profile-build-record",
  { record: recordFlag },
  Effect.fn("Command.profileBuildRecord")(function* ({ record: recordPath }) {
    const target = path.resolve(process.cwd(), recordPath)
    const build = yield* io(
      "read build performance record",
      target,
      async () =>
        JSON.parse(await fs.readFile(target, "utf8")) as {
          readonly id: string
          readonly platform: string
          readonly buildDecision: string
          readonly performance: {
            readonly phases: ReadonlyArray<{
              readonly name: string
              readonly startedAtMillis: number
              readonly finishedAtMillis: number
              readonly durationMillis: number
            }>
            readonly caches: ReadonlyArray<unknown>
          }
        },
    )
    const inheritedToolchainPhases = build.performance.phases.filter(({ name }) =>
      name.startsWith("upstream-"),
    )
    const buildPhases = build.performance.phases.filter(({ name }) => !name.startsWith("upstream-"))
    yield* Console.log(
      JSON.stringify(
        {
          id: build.id,
          platform: build.platform,
          buildDecision: build.buildDecision,
          ...profileBuildPhases(buildPhases),
          inheritedToolchainMillis: inheritedToolchainPhases.reduce(
            (total, phase) => total + phase.durationMillis,
            0,
          ),
          caches: build.performance.caches,
        },
        null,
        2,
      ),
    )
  }),
).pipe(Command.withDescription("Profile phase timing, gaps, and caches from a build record"))
