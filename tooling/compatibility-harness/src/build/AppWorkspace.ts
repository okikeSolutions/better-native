import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import {
  BuildPipelineError,
  ProbeCatalog,
  isRecord,
  safeBuildId,
  type BuildRequest,
} from "./BuildModel.ts"

export interface PreparedAppWorkspace {
  readonly workspace: string
  readonly appDirectory: string
}

interface Service {
  readonly prepare: (
    request: BuildRequest,
    pinnedNodeModules: string,
  ) => Effect.Effect<PreparedAppWorkspace, BuildPipelineError>
}

export class AppWorkspace extends Context.Service<AppWorkspace, Service>()(
  "@better-native/compatibility-harness/AppWorkspace",
) {}

export const layer = (
  root: string,
): Layer.Layer<AppWorkspace, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    AppWorkspace,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const prepare: Service["prepare"] = (request, pinnedNodeModules) =>
        Effect.gen(function* () {
          if (!safeBuildId.test(request.id)) {
            return yield* new BuildPipelineError({
              phase: "workspace",
              request,
              cause: "build ID is not a safe path segment",
            })
          }
          const workspace = path.join(root, ".artifacts", "workspaces", request.id)
          if (yield* fs.exists(workspace)) {
            return yield* new BuildPipelineError({
              phase: "workspace",
              request,
              cause: "isolated CNG workspace already exists",
            })
          }
          const appDirectory = path.join(workspace, "apps", "compatibility-suite")
          yield* fs.makeDirectory(path.dirname(appDirectory), { recursive: true })
          yield* fs.copy(path.join(root, "apps", "compatibility-suite"), appDirectory)
          yield* fs.symlink(path.join(root, "node_modules"), path.join(workspace, "node_modules"))
          yield* fs.symlink(path.join(root, "vendor"), path.join(workspace, "vendor"))
          yield* fs.symlink(path.join(root, "packages"), path.join(workspace, "packages"))
          const appManifestPath = path.join(appDirectory, "package.json")
          const parsedManifest = yield* fs.readFileString(appManifestPath).pipe(
            Effect.flatMap((text) =>
              Effect.try({
                try: () => JSON.parse(text) as unknown,
                catch: (cause) => new BuildPipelineError({ phase: "workspace", request, cause }),
              }),
            ),
          )
          if (!isRecord(parsedManifest)) {
            return yield* new BuildPipelineError({
              phase: "workspace",
              request,
              cause: "compatibility app package.json must contain a JSON object",
            })
          }
          const expo = isRecord(parsedManifest.expo) ? parsedManifest.expo : {}
          const autolinking = isRecord(expo.autolinking) ? expo.autolinking : {}
          parsedManifest.expo = {
            ...expo,
            autolinking: {
              ...autolinking,
              searchPaths: [pinnedNodeModules, path.join(root, "node_modules")],
            },
          }
          yield* fs.writeFileString(appManifestPath, `${JSON.stringify(parsedManifest, null, 2)}\n`)
          if (request.probeSpecifier !== undefined) {
            const catalogPath = path.join(
              root,
              "apps",
              "compatibility-suite",
              "src",
              "generated",
              "SurfaceProbeCatalog.json",
            )
            const catalog = yield* fs.readFileString(catalogPath).pipe(
              Effect.flatMap((text) =>
                Effect.try({
                  try: () => JSON.parse(text) as unknown,
                  catch: (cause) => new BuildPipelineError({ phase: "workspace", request, cause }),
                }),
              ),
              Effect.flatMap(Schema.decodeUnknownEffect(ProbeCatalog)),
            )
            const selected = catalog.probes.find(
              ({ specifier }) => specifier === request.probeSpecifier,
            )
            if (
              selected === undefined ||
              (selected.platforms.length > 0 && !selected.platforms.includes(request.platform))
            ) {
              return yield* new BuildPipelineError({
                phase: "workspace",
                request,
                cause: "probe specifier is not in the generated catalog for this platform",
              })
            }
            const source = [
              'import type { SurfaceProbes } from "../SurfaceProbes.ts"',
              "",
              "export const surfaceProbes: SurfaceProbes = new Map([",
              `  [${JSON.stringify(request.probeSpecifier)}, () => require(${JSON.stringify(request.probeSpecifier)}) as unknown],`,
              "])",
              "",
            ].join("\n")
            yield* fs.writeFileString(
              path.join(appDirectory, "src", "generated", `SurfaceProbes.${request.platform}.ts`),
              source,
            )
          }
          return { workspace, appDirectory }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase: "workspace", request, cause }),
          ),
        )
      return AppWorkspace.of({ prepare })
    }),
  )
