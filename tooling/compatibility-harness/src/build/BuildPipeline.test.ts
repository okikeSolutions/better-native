import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import { ArtifactId, BuildId, ContentHash, type BuildRecord } from "../Domain.ts"
import { provideLayer } from "../TestLayers.ts"
import * as HarnessConfig from "../HarnessConfig.ts"
import {
  BuildImportError,
  BuildPipeline,
  BuildPipelineError,
  layer,
  pinnedPluginPackages,
} from "./BuildPipeline.ts"
import { layer as buildCommandLayer } from "./BuildCommand.ts"
import type { BuildRequest } from "./BuildModel.ts"
import { ExpoToolchain, layer as expoToolchainLayer } from "./ExpoToolchain.ts"
import { EvidenceStore } from "../evidence/EvidenceStore.ts"
import { ProcessSupervisor, type ProcessSpec } from "../supervision/ProcessSupervisor.ts"

const expoRevision = "1".repeat(40)
const expoSourceRoot = (root: string) => `${root}/expo-source`

const preparePinnedExpoFixture = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const upstream = expoSourceRoot(root)
    yield* fs.makeDirectory(`${upstream}/node_modules`, { recursive: true })
    yield* fs.makeDirectory(`${upstream}/packages/expo/build`, { recursive: true })
    yield* fs.makeDirectory(`${upstream}/packages/@expo/cli/build/src`, { recursive: true })
    yield* fs.writeFileString(`${upstream}/node_modules/.modules.yaml`, "fresh")
    yield* fs.writeFileString(`${upstream}/packages/expo/build/Expo.js`, "export {}")
    yield* fs.writeFileString(`${upstream}/packages/expo/build/Expo.d.ts`, "export {}")
    yield* fs.writeFileString(`${upstream}/packages/@expo/cli/build/src/index.js`, "export {}")
    for (const packageName of pinnedPluginPackages) {
      yield* fs.makeDirectory(`${upstream}/packages/${packageName}/plugin/build`, {
        recursive: true,
      })
      yield* fs.writeFileString(
        `${upstream}/packages/${packageName}/app.plugin.js`,
        "module.exports = require('./plugin/build/index')",
      )
      yield* fs.writeFileString(
        `${upstream}/packages/${packageName}/plugin/build/index.js`,
        "module.exports = {}",
      )
    }
  })

const unusedProcesses = Layer.succeed(
  ProcessSupervisor,
  ProcessSupervisor.of({
    start: () => Effect.die("unexpected process start"),
    run: () => Effect.die("unexpected process run"),
  }),
)

const unusedEvidence = Layer.succeed(
  EvidenceStore,
  EvidenceStore.of({
    writeBytes: () => Effect.die("unexpected evidence write"),
    writeJson: () => Effect.die("unexpected evidence write"),
  }),
)

const harnessConfig = (root: string) =>
  HarnessConfig.layer(root).pipe(Layer.provide(NodeServices.layer))
const dependencies = Layer.mergeAll(NodeServices.layer, unusedProcesses, unusedEvidence)

const buildPipelineLayer = (root: string) => {
  const commands = buildCommandLayer
  const config = harnessConfig(root)
  const toolchain = expoToolchainLayer(root, expoSourceRoot(root)).pipe(
    Layer.provide(Layer.merge(commands, config)),
  )
  return layer(root).pipe(Layer.provide(Layer.mergeAll(commands, toolchain, config)))
}

const prepareToolchain = (root: string, request: BuildRequest) =>
  Effect.gen(function* () {
    const toolchain = yield* ExpoToolchain
    return yield* toolchain.prepare(request)
  }).pipe(
    provideLayer(
      expoToolchainLayer(root, expoSourceRoot(root)).pipe(
        Layer.provide(Layer.merge(buildCommandLayer, harnessConfig(root))),
      ),
    ),
  )

const ensureToolchain = (root: string, request: BuildRequest) =>
  Effect.gen(function* () {
    const toolchain = yield* ExpoToolchain
    return yield* toolchain.ensure(request)
  }).pipe(
    provideLayer(
      expoToolchainLayer(root, expoSourceRoot(root)).pipe(
        Layer.provide(Layer.merge(buildCommandLayer, harnessConfig(root))),
      ),
    ),
  )

describe("BuildPipeline imported products", () => {
  it.effect("accepts a hash-matched Release product and rejects tampering", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const crypto = yield* Crypto.Crypto
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-build-import-" })
      const binaryPath = `${root}/app-release.apk`
      const recordPath = `${root}/record.json`
      const bytes = new TextEncoder().encode("release-binary")
      yield* fs.writeFile(binaryPath, bytes)
      const nativeBinaryHash = yield* crypto
        .digest("SHA-256", bytes)
        .pipe(Effect.map((digest) => ContentHash.make(Encoding.encodeHex(digest))))
      const record: BuildRecord = {
        schemaVersion: 2,
        id: BuildId.make("imported-build"),
        mode: "candidate",
        platform: "android",
        expoRevision,
        candidateRevision: "candidate-revision",
        configurationHash: nativeBinaryHash,
        bundleHash: nativeBinaryHash,
        nativeBinaryHash,
        nativeFingerprint: null,
        toolchainFingerprint: null,
        buildDecision: "full-build",
        nativeArtifact: null,
        performance: { architecture: "test", phases: [], caches: [] },
        artifacts: [],
      }
      yield* fs.writeFileString(recordPath, JSON.stringify(record))
      const program = Effect.gen(function* () {
        const builds = yield* BuildPipeline
        const loaded = yield* builds.load({ recordPath, binaryPath, platform: "android" })
        assert.strictEqual(loaded.record.id, record.id)
        assert.strictEqual(loaded.output, binaryPath)

        yield* fs.writeFileString(binaryPath, "tampered")
        const failure = yield* builds
          .load({ recordPath, binaryPath, platform: "android" })
          .pipe(Effect.flip)
        assert.instanceOf(failure, BuildImportError)
        assert.match(String(failure.cause), /hash/)
      }).pipe(provideLayer(buildPipelineLayer(root).pipe(Layer.provideMerge(dependencies))))
      yield* program
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("rejects external and cyclic symbolic links in imported build trees", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-build-links-" })
      const outside = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-build-outside-" })
      yield* fs.writeFileString(`${outside}/secret`, "outside")
      const binaryPath = `${root}/BetterNativeCompatibility.app`
      yield* fs.makeDirectory(binaryPath)
      yield* fs.writeFileString(`${binaryPath}/executable`, "binary")
      const recordPath = `${root}/record.json`
      const placeholder = ContentHash.make("0".repeat(64))
      const record: BuildRecord = {
        schemaVersion: 2,
        id: BuildId.make("linked-build"),
        mode: "candidate",
        platform: "ios",
        expoRevision,
        candidateRevision: "candidate-revision",
        configurationHash: placeholder,
        bundleHash: placeholder,
        nativeBinaryHash: placeholder,
        nativeFingerprint: null,
        toolchainFingerprint: null,
        buildDecision: "full-build",
        nativeArtifact: null,
        performance: { architecture: "test", phases: [], caches: [] },
        artifacts: [],
      }
      yield* fs.writeFileString(recordPath, JSON.stringify(record))
      yield* fs.symlink(`${outside}/secret`, `${binaryPath}/external`)
      const externalFailure = yield* Effect.gen(function* () {
        const builds = yield* BuildPipeline
        return yield* builds.load({ recordPath, binaryPath, platform: "ios" })
      }).pipe(
        provideLayer(buildPipelineLayer(root).pipe(Layer.provideMerge(dependencies))),
        Effect.flip,
      )
      assert.instanceOf(externalFailure, BuildImportError)
      assert.match(String(externalFailure.cause), /symbolic link/)

      yield* fs.remove(`${binaryPath}/external`)
      yield* fs.symlink(binaryPath, `${binaryPath}/cycle`)
      const cyclicFailure = yield* Effect.gen(function* () {
        const builds = yield* BuildPipeline
        return yield* builds.load({ recordPath, binaryPath, platform: "ios" })
      }).pipe(
        provideLayer(buildPipelineLayer(root).pipe(Layer.provideMerge(dependencies))),
        Effect.flip,
      )
      assert.instanceOf(cyclicFailure, BuildImportError)
      assert.match(String(cyclicFailure.cause), /symbolic link/)
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("preserves the process build phase when a command exits unsuccessfully", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-build-phase-" })
      for (const directory of [
        `${root}/apps/compatibility-suite`,
        `${root}/node_modules`,
        `${root}/packages`,
      ]) {
        yield* fs.makeDirectory(directory, { recursive: true })
      }
      yield* preparePinnedExpoFixture(root)
      yield* fs.writeFileString(`${root}/apps/compatibility-suite/package.json`, "{}")
      const calls: Array<ProcessSpec> = []
      const evidenceNames: Array<string> = []
      const processes = Layer.succeed(
        ProcessSupervisor,
        ProcessSupervisor.of({
          start: () => Effect.die("unexpected process start"),
          run: (spec) =>
            Effect.sync(() => {
              calls.push(spec)
              if (spec.command === "git") {
                if (spec.args?.includes("rev-parse")) {
                  return {
                    exitCode: 0,
                    observations: [
                      {
                        sequence: 0,
                        timestampMillis: 0,
                        stream: "stdout" as const,
                        text: expoRevision,
                      },
                    ],
                  }
                }
                return {
                  exitCode: 0,
                  observations: [],
                }
              }
              if (spec.command === "corepack") return { exitCode: 0, observations: [] }
              if (
                spec.command === "node" &&
                spec.args?.some((argument) =>
                  argument.endsWith("verify-expo-package-resolution.mjs"),
                )
              ) {
                return { exitCode: 0, observations: [] }
              }
              if (spec.command === "node" && spec.args?.includes("config")) {
                return { exitCode: 0, observations: [] }
              }
              return { exitCode: 7, observations: [] }
            }),
        }),
      )
      const evidence = Layer.succeed(
        EvidenceStore,
        EvidenceStore.of({
          writeBytes: (_collection, recordId, name) =>
            Effect.sync(() => {
              evidenceNames.push(name)
              return {
                id: ArtifactId.make(`builds/${recordId}/${name}@${"0".repeat(64)}`),
                path: `.artifacts/builds/${recordId}/${name}`,
                mediaType: "application/x-ndjson",
                size: 0,
                hash: ContentHash.make("0".repeat(64)),
              }
            }),
          writeJson: () => Effect.die("unexpected evidence record"),
        }),
      )
      const failure = yield* Effect.gen(function* () {
        yield* prepareToolchain(root, {
          id: BuildId.make("failed-expo"),
          mode: "upstream",
          platform: "web",
          expoRevision,
          candidateRevision: null,
          timeoutMillis: 1_000,
        })
        const builds = yield* BuildPipeline
        return yield* builds
          .build({
            id: BuildId.make("failed-web-build"),
            mode: "candidate",
            platform: "web",
            expoRevision,
            candidateRevision: "candidate-revision",
            timeoutMillis: 1_000,
          })
          .pipe(Effect.flip)
      }).pipe(
        provideLayer(
          buildPipelineLayer(root).pipe(
            Layer.provideMerge(Layer.mergeAll(NodeServices.layer, processes, evidence)),
          ),
        ),
      )
      assert.instanceOf(failure, BuildPipelineError)
      assert.strictEqual(failure.phase, "build", String(failure.cause))
      assert.include(evidenceNames, "upstream-source-status.ndjson")
      assert.include(evidenceNames, "upstream-post-build-status.ndjson")
      assert.isTrue(yield* fs.exists(`${expoSourceRoot(root)}/node_modules/.modules.yaml`))
      const sourceStatusIndex = calls.findIndex(
        ({ command, args }) => command === "git" && args?.includes("status"),
      )
      const installIndex = calls.findIndex(
        ({ command, args }) => command === "corepack" && args?.includes("install"),
      )
      const install = calls[installIndex]
      assert.isFalse(install?.args?.includes("--ignore-scripts") === true)
      assert.isFalse(calls.some(({ args }) => args?.includes("rebuild") === true))
      assert.isFalse(calls.some(({ args }) => args?.includes("turbo") === true))
      const postBuildStatusIndex = calls.findLastIndex(
        ({ command, args }) => command === "git" && args?.includes("status"),
      )
      assert.isAtLeast(sourceStatusIndex, 0)
      assert.isAbove(installIndex, sourceStatusIndex)
      assert.isAbove(postBuildStatusIndex, installIndex)
      const configIndex = calls.findIndex(
        ({ command, args }) => command === "node" && args?.includes("config"),
      )
      const packageResolutionIndex = calls.findIndex(
        ({ command, args }) =>
          command === "node" &&
          args?.some((argument) => argument.endsWith("verify-expo-package-resolution.mjs")),
      )
      const exportIndex = calls.findIndex(
        ({ command, args }) => command === "node" && args?.includes("export"),
      )
      assert.strictEqual(
        calls[exportIndex]?.env?.BETTER_NATIVE_UPSTREAM_NODE_MODULES,
        `${root}/.artifacts/workspaces/web-candidate/node_modules`,
        "Metro must resolve against the selective app materialization",
      )
      assert.isAtLeast(
        packageResolutionIndex,
        0,
        "pinned package resolution must be verified before CNG",
      )
      assert.isAbove(
        configIndex,
        packageResolutionIndex,
        "package resolution must be verified before config evaluation",
      )
      assert.isAtLeast(configIndex, 0, "the pinned Expo CLI config command must execute")
      assert.isAbove(exportIndex, configIndex, "config evaluation must precede bundling")
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("rejects invalid revisions before constructing a cache path", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-build-revision-" })
      const failure = yield* Effect.gen(function* () {
        const builds = yield* BuildPipeline
        return yield* builds
          .build({
            id: BuildId.make("invalid-revision"),
            mode: "upstream",
            platform: "web",
            expoRevision: "../../outside",
            candidateRevision: null,
            timeoutMillis: 1_000,
          })
          .pipe(Effect.flip)
      }).pipe(provideLayer(buildPipelineLayer(root).pipe(Layer.provideMerge(dependencies))))
      assert.instanceOf(failure, BuildPipelineError)
      assert.strictEqual(failure.phase, "upstream")
      assert.match(String(failure.cause), /40-character/)
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("prepares pinned Expo once before a paired web build", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-build-pair-" })
      for (const directory of [
        `${root}/apps/compatibility-suite`,
        `${root}/node_modules`,
        `${root}/packages`,
      ]) {
        yield* fs.makeDirectory(directory, { recursive: true })
      }
      yield* preparePinnedExpoFixture(root)
      yield* fs.writeFileString(`${root}/apps/compatibility-suite/package.json`, "{}")
      const calls: Array<ProcessSpec> = []
      const processes = Layer.succeed(
        ProcessSupervisor,
        ProcessSupervisor.of({
          start: () => Effect.die("unexpected process start"),
          run: (spec) =>
            Effect.gen(function* () {
              calls.push(spec)
              if (spec.command === "git" && spec.args?.includes("rev-parse")) {
                return {
                  exitCode: 0,
                  observations: [
                    {
                      sequence: 0,
                      timestampMillis: 0,
                      stream: "stdout" as const,
                      text: expoRevision,
                    },
                  ],
                }
              }
              if (spec.command === "node" && spec.args?.includes("export")) {
                const outputIndex = spec.args.indexOf("--output-dir")
                const output = spec.args[outputIndex + 1]
                if (output === undefined) return yield* Effect.die("missing web output path")
                yield* fs.makeDirectory(output, { recursive: true })
                yield* fs.writeFileString(
                  `${output}/index.html`,
                  spec.env?.BETTER_NATIVE_MODE ?? "",
                )
              }
              return { exitCode: 0, observations: [] }
            }).pipe(Effect.orDie),
        }),
      )
      const evidence = Layer.succeed(
        EvidenceStore,
        EvidenceStore.of({
          writeBytes: (_collection, recordId, name) =>
            Effect.succeed({
              id: ArtifactId.make(`builds/${recordId}/${name}@${"0".repeat(64)}`),
              path: `.artifacts/builds/${recordId}/${name}`,
              mediaType: "application/x-ndjson",
              size: 0,
              hash: ContentHash.make("0".repeat(64)),
            }),
          writeJson: (_collection, recordId, name) =>
            Effect.succeed({
              id: ArtifactId.make(`builds/${recordId}/${name}@${"0".repeat(64)}`),
              path: `.artifacts/builds/${recordId}/${name}`,
              mediaType: "application/json",
              size: 0,
              hash: ContentHash.make("0".repeat(64)),
            }),
        }),
      )
      const pair = yield* Effect.gen(function* () {
        const preparation = {
          id: BuildId.make("paired-expo"),
          mode: "upstream",
          platform: "web",
          expoRevision,
          candidateRevision: null,
          timeoutMillis: 1_000,
        } as const
        yield* prepareToolchain(root, preparation)
        yield* ensureToolchain(root, preparation)
        const builds = yield* BuildPipeline
        return yield* builds.buildPair({
          materializationId: BuildId.make("paired-expo"),
          upstream: {
            id: BuildId.make("paired-upstream"),
            mode: "upstream",
            platform: "web",
            expoRevision,
            candidateRevision: null,
            timeoutMillis: 1_000,
          },
          candidate: {
            id: BuildId.make("paired-candidate"),
            mode: "candidate",
            platform: "web",
            expoRevision,
            candidateRevision: "candidate-revision",
            timeoutMillis: 1_000,
          },
        })
      }).pipe(
        provideLayer(
          buildPipelineLayer(root).pipe(
            Layer.provideMerge(Layer.mergeAll(NodeServices.layer, processes, evidence)),
          ),
        ),
      )
      assert.strictEqual(pair.upstream.record.mode, "upstream")
      assert.strictEqual(pair.candidate.record.mode, "candidate")
      assert.strictEqual(
        calls.filter(({ command, args }) => command === "git" && args?.includes("worktree")).length,
        0,
      )
      assert.strictEqual(
        calls.filter(({ command, args }) => command === "corepack" && args?.includes("install"))
          .length,
        1,
      )
      assert.strictEqual(
        calls.filter(({ command, args }) => command === "node" && args?.includes("export")).length,
        2,
      )
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("rejects a symbolic-link external Expo root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-cache-link-" })
      const outside = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-cache-outside-" })
      yield* fs.symlink(outside, expoSourceRoot(root))
      const failure = yield* Effect.gen(function* () {
        const builds = yield* BuildPipeline
        return yield* builds
          .build({
            id: BuildId.make("linked-cache"),
            mode: "upstream",
            platform: "web",
            expoRevision,
            candidateRevision: null,
            timeoutMillis: 1_000,
          })
          .pipe(Effect.flip)
      }).pipe(provideLayer(buildPipelineLayer(root).pipe(Layer.provideMerge(dependencies))))
      assert.instanceOf(failure, BuildPipelineError)
      assert.match(String(failure.cause), /symbolic-link Expo source root/)
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )
})
