import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import { EvidenceStore } from "../evidence/EvidenceStore.ts"
import { HarnessConfig } from "../HarnessConfig.ts"
import { AppBuildExecutor, layer as appBuildExecutorLayer } from "./AppBuildExecutor.ts"
import { AppBuildImporter, layer as appBuildImporterLayer } from "./AppBuildImporter.ts"
import { layer as appWorkspaceLayer } from "./AppWorkspace.ts"
import { BuildCommand } from "./BuildCommand.ts"
import {
  BuildImportError,
  BuildPipelineError,
  type BuildImportRequest,
  type BuildOutput,
  type BuildPairOutput,
  type BuildPairRequest,
  type BuildRequest,
} from "./BuildModel.ts"
import { layer as buildProductsLayer } from "./BuildProducts.ts"
import { ExpoToolchain } from "./ExpoToolchain.ts"
import { layer as nativeArtifactCacheLayer } from "./NativeArtifactCache.ts"

export { BuildImportError, BuildPipelineError, pinnedPluginPackages } from "./BuildModel.ts"
export type {
  BuildImportRequest,
  BuildOutput,
  BuildPairOutput,
  BuildPairRequest,
  BuildRequest,
} from "./BuildModel.ts"

export interface Service {
  readonly build: (request: BuildRequest) => Effect.Effect<BuildOutput, BuildPipelineError>
  readonly buildPair: (
    request: BuildPairRequest,
  ) => Effect.Effect<BuildPairOutput, BuildPipelineError>
  readonly load: (request: BuildImportRequest) => Effect.Effect<BuildOutput, BuildImportError>
}

export class BuildPipeline extends Context.Service<BuildPipeline, Service>()(
  "@better-native/compatibility-harness/BuildPipeline",
) {}

const serviceLayer: Layer.Layer<
  BuildPipeline,
  never,
  AppBuildExecutor | AppBuildImporter | ExpoToolchain
> = Layer.effect(
  BuildPipeline,
  Effect.gen(function* () {
    const executor = yield* AppBuildExecutor
    const importer = yield* AppBuildImporter
    const toolchain = yield* ExpoToolchain
    const build: Service["build"] = (request) =>
      toolchain
        .load(request)
        .pipe(Effect.flatMap((pinnedUpstream) => executor.execute(request, pinnedUpstream)))
    const buildPair: Service["buildPair"] = ({ materializationId, upstream, candidate }) =>
      Effect.gen(function* () {
        const modesArePaired = Match.value({
          upstream: upstream.mode,
          candidate: candidate.mode,
        }).pipe(
          Match.when({ upstream: "upstream", candidate: "candidate" }, () => true),
          Match.orElse(() => false),
        )
        if (!modesArePaired) {
          return yield* new BuildPipelineError({
            phase: "workspace",
            request: upstream,
            cause: "paired builds require upstream and candidate modes in that order",
          })
        }
        if (
          upstream.platform !== candidate.platform ||
          upstream.expoRevision !== candidate.expoRevision ||
          upstream.timeoutMillis !== candidate.timeoutMillis ||
          upstream.probeSpecifier !== candidate.probeSpecifier
        ) {
          return yield* new BuildPipelineError({
            phase: "workspace",
            request: upstream,
            cause:
              "paired builds must use the same platform, Expo revision, timeout, and probe specifier",
          })
        }
        const materializationRequest: BuildRequest = {
          ...upstream,
          id: materializationId,
        }
        const pinnedUpstream = yield* toolchain.load(materializationRequest)
        const upstreamOutput = yield* executor.execute(upstream, pinnedUpstream)
        const candidateOutput = yield* executor.execute(candidate, pinnedUpstream)
        return { upstream: upstreamOutput, candidate: candidateOutput }
      })
    const load: Service["load"] = importer.load
    return BuildPipeline.of({ build, buildPair, load })
  }),
)

export const layer = (
  root: string,
): Layer.Layer<
  BuildPipeline,
  never,
  | BuildCommand
  | ExpoToolchain
  | EvidenceStore
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | HarnessConfig
> => {
  const core = Layer.mergeAll(buildProductsLayer, appWorkspaceLayer(root))
  const shared = Layer.mergeAll(
    core,
    nativeArtifactCacheLayer(root).pipe(Layer.provideMerge(buildProductsLayer)),
  )
  const dependencies = Layer.mergeAll(
    shared,
    appBuildExecutorLayer(root).pipe(Layer.provideMerge(shared)),
    appBuildImporterLayer(root).pipe(Layer.provideMerge(buildProductsLayer)),
  )
  return serviceLayer.pipe(Layer.provide(dependencies))
}
