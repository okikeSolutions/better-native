import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { BuildId, BuildRecord, type BuildRecord as BuildRecordType } from "../Domain.ts"
import { EvidenceStore } from "../evidence/EvidenceStore.ts"
import { AppWorkspace } from "./AppWorkspace.ts"
import { BuildCommand, type BuildCommandResult } from "./BuildCommand.ts"
import {
  BuildPipelineError,
  type BuildOutput,
  type BuildRequest,
  type PinnedExpoToolchain,
} from "./BuildModel.ts"
import { BuildProducts } from "./BuildProducts.ts"

interface Service {
  readonly execute: (
    request: BuildRequest,
    toolchain: PinnedExpoToolchain,
  ) => Effect.Effect<BuildOutput, BuildPipelineError>
}

export class AppBuildExecutor extends Context.Service<AppBuildExecutor, Service>()(
  "@better-native/compatibility-harness/AppBuildExecutor",
) {}

export const layer: Layer.Layer<
  AppBuildExecutor,
  never,
  AppWorkspace | BuildCommand | BuildProducts | EvidenceStore | Path.Path
> = Layer.effect(
  AppBuildExecutor,
  Effect.gen(function* () {
    const path = yield* Path.Path
    const evidence = yield* EvidenceStore
    const workspace = yield* AppWorkspace
    const commands = yield* BuildCommand
    const products = yield* BuildProducts
    const execute: Service["execute"] = (request, pinnedUpstream) =>
      Effect.gen(function* () {
        const { appDirectory, workspace: workspaceRoot } = yield* workspace.prepare(
          request,
          pinnedUpstream.nodeModules,
        )
        const commonEnv = {
          BETTER_NATIVE_MODE: request.mode,
          BETTER_NATIVE_BUILD_ID: request.id,
          BETTER_NATIVE_RUN_ID: `build-${request.id}`,
          CI: "1",
          BETTER_NATIVE_UPSTREAM_NODE_MODULES: pinnedUpstream.nodeModules,
          BETTER_NATIVE_PINNED_EXPO_ROOT: pinnedUpstream.root,
        }
        const expoCli = path.join(pinnedUpstream.root, "packages", "expo", "bin", "cli")
        const results: Array<BuildCommandResult> = []
        results.push(
          yield* commands.run(request, "prebuild", "config-evaluation.ndjson", {
            command: "node",
            args: [expoCli, "config", "--type", "prebuild", "--json"],
            cwd: appDirectory,
            env: commonEnv,
            timeoutMillis: Math.min(request.timeoutMillis, 120_000),
          }),
        )
        let output: string
        if (request.platform === "web") {
          output = path.join(workspaceRoot, "dist")
          results.push(
            yield* commands.run(request, "build", "process-1.ndjson", {
              command: "node",
              args: [
                expoCli,
                "export",
                "--platform",
                "web",
                "--no-minify",
                "--output-dir",
                output,
                "--clear",
              ],
              cwd: appDirectory,
              env: commonEnv,
              timeoutMillis: request.timeoutMillis,
            }),
          )
        } else {
          results.push(
            yield* commands.run(request, "prebuild", "process-1.ndjson", {
              command: "node",
              args: [
                expoCli,
                "prebuild",
                "--clean",
                "--no-install",
                "--platform",
                request.platform,
              ],
              cwd: appDirectory,
              env: commonEnv,
              timeoutMillis: request.timeoutMillis,
            }),
          )
          if (request.platform === "android") {
            output = path.join(
              appDirectory,
              "android",
              "app",
              "build",
              "outputs",
              "apk",
              "release",
              "app-release.apk",
            )
            results.push(
              yield* commands.run(request, "build", "process-2.ndjson", {
                command: path.join(appDirectory, "android", "gradlew"),
                args: [":app:assembleRelease", "--no-daemon", "--stacktrace"],
                cwd: path.join(appDirectory, "android"),
                env: commonEnv,
                timeoutMillis: request.timeoutMillis,
              }),
            )
          } else {
            const iosDirectory = path.join(appDirectory, "ios")
            const derived = path.join(workspaceRoot, "derived-data")
            results.push(
              yield* commands.run(request, "build", "process-2.ndjson", {
                command: "pod",
                args: ["install"],
                cwd: iosDirectory,
                env: commonEnv,
                timeoutMillis: request.timeoutMillis,
              }),
            )
            results.push(
              yield* commands.run(request, "build", "process-3.ndjson", {
                command: "xcodebuild",
                args: [
                  "-workspace",
                  path.join(iosDirectory, "BetterNativeCompatibility.xcworkspace"),
                  "-scheme",
                  "BetterNativeCompatibility",
                  "-configuration",
                  "Release",
                  "-sdk",
                  "iphonesimulator",
                  "-derivedDataPath",
                  derived,
                  "build",
                ],
                cwd: iosDirectory,
                env: commonEnv,
                timeoutMillis: request.timeoutMillis,
              }),
            )
            output = path.join(
              derived,
              "Build",
              "Products",
              "Release-iphonesimulator",
              "BetterNativeCompatibility.app",
            )
          }
        }
        // Keep the verbose materialization logs once under the pair ID. Each
        // portable build record receives a compact, hash-addressed attestation.
        const materializationArtifact = yield* commands
          .persistObservations(request, "upstream-materialization.ndjson", [
            {
              sequence: 0,
              timestampMillis: 0,
              stream: "stdout",
              text: JSON.stringify({
                expoRevision: request.expoRevision,
                artifacts: pinnedUpstream.artifacts.map(({ id, hash }) => ({ id, hash })),
              }),
            },
          ])
          .pipe(
            Effect.mapError(
              (cause) => new BuildPipelineError({ phase: "evidence", request, cause }),
            ),
          )
        const artifacts = [materializationArtifact, ...results.map(({ artifact }) => artifact)]
        const bundleHash = yield* products
          .hash(output)
          .pipe(
            Effect.mapError((cause) => new BuildPipelineError({ phase: "build", request, cause })),
          )
        const configurationHash = yield* products
          .digest(
            new TextEncoder().encode(
              JSON.stringify({
                mode: request.mode,
                platform: request.platform,
                expoRevision: request.expoRevision,
                candidateRevision: request.candidateRevision,
                probeSpecifier: request.probeSpecifier ?? null,
              }),
            ),
          )
          .pipe(
            Effect.mapError(
              (cause) => new BuildPipelineError({ phase: "evidence", request, cause }),
            ),
          )
        const record: BuildRecordType = {
          schemaVersion: 1,
          id: BuildId.make(request.id),
          mode: request.mode,
          platform: request.platform,
          expoRevision: request.expoRevision,
          candidateRevision: request.candidateRevision,
          configurationHash,
          bundleHash,
          nativeBinaryHash: request.platform === "web" ? null : bundleHash,
          artifacts,
        }
        yield* evidence
          .writeJson("builds", request.id, "record.json", BuildRecord, record)
          .pipe(
            Effect.mapError(
              (cause) => new BuildPipelineError({ phase: "evidence", request, cause }),
            ),
          )
        return {
          record,
          workspace: workspaceRoot,
          appDirectory,
          output,
          expoCli,
          observations: [
            ...pinnedUpstream.observations,
            ...results.flatMap(({ result }) => result.observations),
          ],
        }
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof BuildPipelineError
            ? cause
            : new BuildPipelineError({ phase: "build", request, cause }),
        ),
      )
    return AppBuildExecutor.of({ execute })
  }),
)
