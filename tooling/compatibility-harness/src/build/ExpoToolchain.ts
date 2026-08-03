import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { Artifact } from "../Domain.ts"
import { ProcessSupervisor } from "../supervision/ProcessSupervisor.ts"
import { BuildCommand, type BuildCommandResult } from "./BuildCommand.ts"
import {
  BuildPipelineError,
  gitRevision,
  pinnedPluginPackages,
  safeBuildId,
  type BuildRequest,
  type PinnedExpoToolchain,
} from "./BuildModel.ts"

const ToolchainRecord = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  lifecycle: Schema.Literal("expo-normal-install-v1"),
  expoRevision: Schema.String,
  artifacts: Schema.Array(Artifact),
})

interface Service {
  readonly prepare: (
    request: BuildRequest,
  ) => Effect.Effect<PinnedExpoToolchain, BuildPipelineError>
  readonly ensure: (request: BuildRequest) => Effect.Effect<PinnedExpoToolchain, BuildPipelineError>
  readonly load: (request: BuildRequest) => Effect.Effect<PinnedExpoToolchain, BuildPipelineError>
}

export class ExpoToolchain extends Context.Service<ExpoToolchain, Service>()(
  "@better-native/compatibility-harness/ExpoToolchain",
) {}

const validateRequest = (request: BuildRequest) =>
  Effect.gen(function* () {
    if (!safeBuildId.test(request.id)) {
      return yield* new BuildPipelineError({
        phase: "upstream",
        request,
        cause: "build ID is not a safe path segment",
      })
    }
    if (!gitRevision.test(request.expoRevision)) {
      return yield* new BuildPipelineError({
        phase: "upstream",
        request,
        cause: "Expo revision must be a full 40-character lowercase Git revision",
      })
    }
    return undefined
  })

export const layer = (
  root: string,
): Layer.Layer<
  ExpoToolchain,
  never,
  BuildCommand | ProcessSupervisor | FileSystem.FileSystem | Path.Path
> =>
  Layer.effect(
    ExpoToolchain,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const commands = yield* BuildCommand
      const processes = yield* ProcessSupervisor

      const locations = (revision: string) => {
        const upstream = path.join(root, "vendor", "expo")
        return {
          upstream,
          nodeModules: path.join(upstream, "node_modules"),
          record: path.join(root, ".artifacts", "toolchains", `expo-${revision}`, "record.json"),
        }
      }

      const validateFiles = (request: BuildRequest, upstream: string) =>
        Effect.gen(function* () {
          const required = [
            [path.join(upstream, "node_modules"), "Directory"],
            [path.join(upstream, "node_modules", ".modules.yaml"), "File"],
            [path.join(upstream, "packages", "expo", "build", "Expo.js"), "File"],
            [path.join(upstream, "packages", "expo", "build", "Expo.d.ts"), "File"],
            [path.join(upstream, "packages", "@expo", "cli", "build", "src", "index.js"), "File"],
          ] as const
          for (const [target, type] of required) {
            const canonical = yield* fs
              .realPath(target)
              .pipe(Effect.mapError(() => `required pinned Expo artifact is missing: ${target}`))
            if (canonical !== target || (yield* fs.stat(canonical)).type !== type) {
              return yield* new BuildPipelineError({
                phase: "upstream",
                request,
                cause: `required pinned Expo artifact is not a real ${type.toLowerCase()}: ${target}`,
              })
            }
          }
          for (const packageName of pinnedPluginPackages) {
            const plugin = path.join(upstream, "packages", packageName, "app.plugin.js")
            const source = yield* fs
              .readFileString(plugin)
              .pipe(Effect.mapError(() => `required pinned Expo plugin is missing: ${plugin}`))
            const target = source.match(/require\(['"](.+?)['"]\)/)?.[1]
            if (target === undefined) {
              return yield* new BuildPipelineError({
                phase: "upstream",
                request,
                cause: `pinned Expo plugin has no statically verifiable implementation: ${plugin}`,
              })
            }
            const implementation = path.resolve(path.dirname(plugin), target)
            const implementationFile = implementation.endsWith(".js")
              ? implementation
              : `${implementation}.js`
            if (!(yield* fs.exists(implementationFile))) {
              return yield* new BuildPipelineError({
                phase: "upstream",
                request,
                cause: `pinned Expo plugin implementation is missing: ${implementationFile}`,
              })
            }
          }
          return undefined
        })

      const inspectRevision = (request: BuildRequest, upstream: string) =>
        Effect.gen(function* () {
          const revision = yield* commands.run(request, "upstream", "upstream-revision.ndjson", {
            command: "git",
            args: ["-C", upstream, "rev-parse", "HEAD"],
            cwd: root,
            timeoutMillis: Math.min(request.timeoutMillis, 30_000),
          })
          const actualRevision = revision.result.observations
            .filter(({ stream }) => stream === "stdout")
            .map(({ text }) => text)
            .join("")
            .trim()
          if (actualRevision !== request.expoRevision) {
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: `pinned Expo workspace HEAD ${actualRevision || "<unavailable>"} differs from ${request.expoRevision}`,
            })
          }
          return revision
        })

      const validateRevision = (request: BuildRequest, upstream: string) =>
        Effect.gen(function* () {
          const result = yield* processes.run({
            command: "git",
            args: ["-C", upstream, "rev-parse", "HEAD"],
            cwd: root,
            timeoutMillis: Math.min(request.timeoutMillis, 30_000),
          })
          const actualRevision = result.observations
            .filter(({ stream }) => stream === "stdout")
            .map(({ text }) => text)
            .join("")
            .trim()
          if (result.exitCode !== 0 || actualRevision !== request.expoRevision) {
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: `pinned Expo workspace HEAD ${actualRevision || "<unavailable>"} differs from ${request.expoRevision}`,
            })
          }
          return undefined
        })

      const prepare: Service["prepare"] = (request) =>
        Effect.gen(function* () {
          yield* validateRequest(request)
          const canonicalRoot = yield* fs.realPath(root)
          const { upstream, nodeModules, record } = locations(request.expoRevision)
          const canonicalUpstream = yield* fs.realPath(upstream).pipe(
            Effect.mapError(
              (cause) =>
                new BuildPipelineError({
                  phase: "upstream",
                  request,
                  cause: `pinned Expo submodule is unavailable: ${String(cause)}`,
                }),
            ),
          )
          if (canonicalUpstream !== path.join(canonicalRoot, "vendor", "expo")) {
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: `refusing symbolic-link pinned Expo root ${upstream} -> ${canonicalUpstream}`,
            })
          }
          const results: Array<BuildCommandResult> = [
            yield* inspectRevision(request, canonicalUpstream),
          ]
          const sourceStatus = yield* commands.run(
            request,
            "upstream",
            "upstream-source-status.ndjson",
            {
              command: "git",
              args: ["-C", canonicalUpstream, "status", "--short", "--untracked-files=no"],
              cwd: root,
              timeoutMillis: Math.min(request.timeoutMillis, 30_000),
            },
          )
          results.push(sourceStatus)
          if (
            sourceStatus.result.observations.some(
              ({ stream, text }) => stream === "stdout" && text.length > 0,
            )
          ) {
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: "pinned Expo submodule contains modified tracked files",
            })
          }
          results.push(
            yield* commands.run(request, "upstream", "upstream-install.ndjson", {
              command: "corepack",
              args: ["pnpm@10.33.0", "install", "--frozen-lockfile"],
              env: { COREPACK_ENABLE_PROJECT_SPEC: "0" },
              cwd: canonicalUpstream,
              timeoutMillis: request.timeoutMillis,
            }),
          )
          results.push(
            yield* commands.run(request, "upstream", "upstream-post-build-status.ndjson", {
              command: "git",
              args: ["-C", canonicalUpstream, "status", "--short", "--untracked-files=no"],
              cwd: root,
              timeoutMillis: Math.min(request.timeoutMillis, 30_000),
            }),
          )
          yield* validateFiles(request, canonicalUpstream)
          const artifacts = results.map(({ artifact }) => artifact)
          yield* fs.makeDirectory(path.dirname(record), { recursive: true })
          const encoded = yield* Schema.encodeEffect(ToolchainRecord)({
            schemaVersion: 2,
            lifecycle: "expo-normal-install-v1",
            expoRevision: request.expoRevision,
            artifacts,
          })
          const temporary = yield* fs.makeTempFile({
            directory: path.dirname(record),
            prefix: ".record.",
            suffix: ".tmp",
          })
          yield* fs.writeFileString(temporary, `${JSON.stringify(encoded, null, 2)}\n`)
          yield* fs.rename(temporary, record)
          return {
            root: canonicalUpstream,
            nodeModules,
            artifacts,
            observations: results.flatMap(({ result }) => result.observations),
          }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase: "upstream", request, cause }),
          ),
        )

      const load: Service["load"] = (request) =>
        Effect.gen(function* () {
          yield* validateRequest(request)
          const canonicalRoot = yield* fs.realPath(root)
          const { upstream, nodeModules, record } = locations(request.expoRevision)
          const canonicalUpstream = yield* fs.realPath(upstream)
          if (canonicalUpstream !== path.join(canonicalRoot, "vendor", "expo")) {
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: `refusing symbolic-link pinned Expo root ${upstream} -> ${canonicalUpstream}`,
            })
          }
          const parsed = yield* fs.readFileString(record).pipe(
            Effect.flatMap((text) =>
              Effect.try({
                try: () => JSON.parse(text) as unknown,
                catch: (cause) => new BuildPipelineError({ phase: "upstream", request, cause }),
              }),
            ),
            Effect.flatMap(Schema.decodeUnknownEffect(ToolchainRecord)),
            Effect.mapError(
              (cause) =>
                new BuildPipelineError({
                  phase: "upstream",
                  request,
                  cause: `Expo toolchain is not prepared; run bun run expo:prepare (${String(cause)})`,
                }),
            ),
          )
          if (parsed.expoRevision !== request.expoRevision) {
            return yield* new BuildPipelineError({
              phase: "upstream",
              request,
              cause: `prepared Expo revision ${parsed.expoRevision} differs from ${request.expoRevision}`,
            })
          }
          yield* validateRevision(request, canonicalUpstream)
          yield* validateFiles(request, canonicalUpstream)
          return {
            root: canonicalUpstream,
            nodeModules,
            artifacts: parsed.artifacts,
            observations: [],
          }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase: "upstream", request, cause }),
          ),
        )

      const ensure: Service["ensure"] = (request) =>
        validateRequest(request).pipe(
          Effect.andThen(fs.exists(locations(request.expoRevision).record)),
          Effect.flatMap((exists) => (exists ? load(request) : prepare(request))),
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase: "upstream", request, cause }),
          ),
        )

      return ExpoToolchain.of({ prepare, ensure, load })
    }),
  )
