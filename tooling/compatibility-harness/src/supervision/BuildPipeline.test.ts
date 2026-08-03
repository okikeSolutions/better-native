import * as BunServices from "@effect/platform-bun/BunServices"
import { assert, describe, it } from "@effect/vitest"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import { ArtifactId, BuildId, ContentHash, type BuildRecord } from "../Domain.ts"
import {
  BuildImportError,
  BuildPipeline,
  BuildPipelineError,
  layer,
  pinnedPluginPackages,
} from "./BuildPipeline.ts"
import { EvidenceStore } from "./EvidenceStore.ts"
import { ProcessSupervisor, type ProcessSpec } from "./ProcessSupervisor.ts"

const expoRevision = "1".repeat(40)

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

const dependencies = Layer.mergeAll(BunServices.layer, unusedProcesses, unusedEvidence)

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
        schemaVersion: 1,
        id: BuildId.make("imported-build"),
        mode: "candidate",
        platform: "android",
        expoRevision,
        candidateRevision: "candidate-revision",
        configurationHash: nativeBinaryHash,
        bundleHash: nativeBinaryHash,
        nativeBinaryHash,
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
      }).pipe(Effect.provide(layer(root).pipe(Layer.provideMerge(dependencies))))
      yield* program
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
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
        schemaVersion: 1,
        id: BuildId.make("linked-build"),
        mode: "candidate",
        platform: "ios",
        expoRevision,
        candidateRevision: "candidate-revision",
        configurationHash: placeholder,
        bundleHash: placeholder,
        nativeBinaryHash: placeholder,
        artifacts: [],
      }
      yield* fs.writeFileString(recordPath, JSON.stringify(record))
      yield* fs.symlink(`${outside}/secret`, `${binaryPath}/external`)
      const externalFailure = yield* Effect.gen(function* () {
        const builds = yield* BuildPipeline
        return yield* builds.load({ recordPath, binaryPath, platform: "ios" })
      }).pipe(Effect.provide(layer(root).pipe(Layer.provideMerge(dependencies))), Effect.flip)
      assert.instanceOf(externalFailure, BuildImportError)
      assert.match(String(externalFailure.cause), /symbolic link/)

      yield* fs.remove(`${binaryPath}/external`)
      yield* fs.symlink(binaryPath, `${binaryPath}/cycle`)
      const cyclicFailure = yield* Effect.gen(function* () {
        const builds = yield* BuildPipeline
        return yield* builds.load({ recordPath, binaryPath, platform: "ios" })
      }).pipe(Effect.provide(layer(root).pipe(Layer.provideMerge(dependencies))), Effect.flip)
      assert.instanceOf(cyclicFailure, BuildImportError)
      assert.match(String(cyclicFailure.cause), /symbolic link/)
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  )

  it.effect("preserves the process build phase when a command exits unsuccessfully", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-build-phase-" })
      for (const directory of [
        `${root}/apps/compatibility-suite`,
        `${root}/node_modules`,
        `${root}/vendor`,
        `${root}/packages`,
      ]) {
        yield* fs.makeDirectory(directory, { recursive: true })
      }
      yield* fs.writeFileString(`${root}/apps/compatibility-suite/package.json`, "{}")
      const calls: Array<ProcessSpec> = []
      const evidenceNames: Array<string> = []
      const processes = Layer.succeed(
        ProcessSupervisor,
        ProcessSupervisor.of({
          start: () => Effect.die("unexpected process start"),
          run: (spec) =>
            Effect.gen(function* () {
              calls.push(spec)
              if (spec.command === "git" && spec.args?.includes("worktree")) {
                const upstream = spec.args.at(-2)
                if (upstream === undefined) return yield* Effect.die("missing worktree path")
                yield* fs
                  .makeDirectory(`${upstream}/node_modules`, { recursive: true })
                  .pipe(Effect.orDie)
                yield* fs
                  .makeDirectory(`${upstream}/packages/expo/build`, {
                    recursive: true,
                  })
                  .pipe(Effect.orDie)
                yield* fs
                  .writeFileString(`${upstream}/node_modules/.modules.yaml`, "fresh")
                  .pipe(Effect.orDie)
                yield* fs
                  .writeFileString(`${upstream}/packages/expo/build/Expo.js`, "export {}")
                  .pipe(Effect.orDie)
                yield* fs
                  .writeFileString(`${upstream}/packages/expo/build/Expo.d.ts`, "export {}")
                  .pipe(Effect.orDie)
                for (const packageName of pinnedPluginPackages) {
                  yield* fs
                    .makeDirectory(`${upstream}/packages/${packageName}/plugin/build`, {
                      recursive: true,
                    })
                    .pipe(Effect.orDie)
                  yield* fs
                    .writeFileString(
                      `${upstream}/packages/${packageName}/app.plugin.js`,
                      "module.exports = require('./plugin/build/index')",
                    )
                    .pipe(Effect.orDie)
                  yield* fs
                    .writeFileString(
                      `${upstream}/packages/${packageName}/plugin/build/index.js`,
                      "module.exports = {}",
                    )
                    .pipe(Effect.orDie)
                }
                return { exitCode: 0, observations: [] }
              }
              if (spec.command === "git") {
                const postBuildStatus =
                  spec.args?.includes("status") === true &&
                  calls.some(
                    ({ command, args }) => command === "corepack" && args?.includes("turbo"),
                  )
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
                  observations: postBuildStatus
                    ? [
                        {
                          sequence: 0,
                          timestampMillis: 0,
                          stream: "stdout" as const,
                          text: " M packages/expo/build/Expo.js",
                        },
                      ]
                    : [],
                }
              }
              if (spec.command === "corepack") return { exitCode: 0, observations: [] }
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
        const builds = yield* BuildPipeline
        return yield* builds
          .build({
            id: "failed-web-build",
            mode: "candidate",
            platform: "web",
            expoRevision,
            candidateRevision: "candidate-revision",
            timeoutMillis: 1_000,
          })
          .pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          layer(root).pipe(
            Layer.provideMerge(Layer.mergeAll(BunServices.layer, processes, evidence)),
          ),
        ),
      )
      assert.instanceOf(failure, BuildPipelineError)
      assert.strictEqual(failure.phase, "build", String(failure.cause))
      assert.include(evidenceNames, "upstream-source-status.ndjson")
      assert.include(evidenceNames, "upstream-post-build-status.ndjson")
      assert.isTrue(
        yield* fs.exists(
          `${root}/.artifacts/upstreams/expo-${expoRevision}-failed-web-build/node_modules/.modules.yaml`,
        ),
      )
      const upstreamBuild = calls.find(
        ({ command, args }) => command === "corepack" && args?.includes("turbo"),
      )
      assert.isDefined(upstreamBuild)
      const sourceStatusIndex = calls.findIndex(
        ({ command, args }) => command === "git" && args?.includes("status"),
      )
      const installIndex = calls.findIndex(
        ({ command, args }) => command === "corepack" && args?.includes("install"),
      )
      const upstreamBuildIndex = calls.indexOf(upstreamBuild)
      const postBuildStatusIndex = calls.findLastIndex(
        ({ command, args }) => command === "git" && args?.includes("status"),
      )
      assert.isAtLeast(sourceStatusIndex, 0)
      assert.isAbove(installIndex, sourceStatusIndex)
      assert.isAbove(upstreamBuildIndex, installIndex)
      assert.isAbove(postBuildStatusIndex, upstreamBuildIndex)
      for (const packageName of pinnedPluginPackages) {
        assert.isTrue(
          upstreamBuild.args?.includes(`${packageName}...`),
          `${packageName} must be materialized before config evaluation`,
        )
      }
      const configIndex = calls.findIndex(
        ({ command, args }) => command === "node" && args?.includes("config"),
      )
      const exportIndex = calls.findIndex(
        ({ command, args }) => command === "node" && args?.includes("export"),
      )
      assert.isAtLeast(configIndex, 0, "the pinned Expo CLI config command must execute")
      assert.isAbove(exportIndex, configIndex, "config evaluation must precede bundling")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  )

  it.effect("rejects invalid revisions before constructing a cache path", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-build-revision-" })
      const failure = yield* Effect.gen(function* () {
        const builds = yield* BuildPipeline
        return yield* builds
          .build({
            id: "invalid-revision",
            mode: "upstream",
            platform: "web",
            expoRevision: "../../outside",
            candidateRevision: null,
            timeoutMillis: 1_000,
          })
          .pipe(Effect.flip)
      }).pipe(Effect.provide(layer(root).pipe(Layer.provideMerge(dependencies))))
      assert.instanceOf(failure, BuildPipelineError)
      assert.strictEqual(failure.phase, "upstream")
      assert.match(String(failure.cause), /40-character/)
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  )

  it.effect(
    "rejects pre-existing executable materializations instead of trusting ignored output",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-tampered-cache-" })
        const upstream = `${root}/.artifacts/upstreams/expo-${expoRevision}-tampered-cache`
        yield* fs.makeDirectory(`${upstream}/node_modules`, { recursive: true })
        yield* fs.writeFileString(`${upstream}/node_modules/payload.js`, "malicious")
        const failure = yield* Effect.gen(function* () {
          const builds = yield* BuildPipeline
          return yield* builds
            .build({
              id: "tampered-cache",
              mode: "upstream",
              platform: "web",
              expoRevision,
              candidateRevision: null,
              timeoutMillis: 1_000,
            })
            .pipe(Effect.flip)
        }).pipe(Effect.provide(layer(root).pipe(Layer.provideMerge(dependencies))))
        assert.instanceOf(failure, BuildPipelineError)
        assert.strictEqual(failure.phase, "upstream")
        assert.match(String(failure.cause), /refusing to reuse executable Expo materialization/)
        assert.strictEqual(
          yield* fs.readFileString(`${upstream}/node_modules/payload.js`),
          "malicious",
        )
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  )

  it.effect("rejects a symbolic-link pinned workspace", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-cache-link-" })
      const outside = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-cache-outside-" })
      yield* fs.makeDirectory(`${root}/.artifacts/upstreams`, { recursive: true })
      yield* fs.symlink(outside, `${root}/.artifacts/upstreams/expo-${expoRevision}-linked-cache`)
      const failure = yield* Effect.gen(function* () {
        const builds = yield* BuildPipeline
        return yield* builds
          .build({
            id: "linked-cache",
            mode: "upstream",
            platform: "web",
            expoRevision,
            candidateRevision: null,
            timeoutMillis: 1_000,
          })
          .pipe(Effect.flip)
      }).pipe(Effect.provide(layer(root).pipe(Layer.provideMerge(dependencies))))
      assert.instanceOf(failure, BuildPipelineError)
      assert.match(String(failure.cause), /symbolic-link pinned Expo workspace/)
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  )
})
