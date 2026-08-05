import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { BuildRecord, ProcessObservation as ProcessObservationSchema } from "../Domain.ts"
import { BuildImportError, type BuildImportRequest, type BuildOutput } from "./BuildModel.ts"
import { BuildProducts } from "./BuildProducts.ts"

interface Service {
  readonly load: (request: BuildImportRequest) => Effect.Effect<BuildOutput, BuildImportError>
}

/** Effect context tag for importing validated native build products. */
export class AppBuildImporter extends Context.Service<AppBuildImporter, Service>()(
  "@better-native/compatibility-harness/AppBuildImporter",
) {}

/**
 * Builds the importer that verifies binary and observation hashes before use.
 *
 * @param root - Better Native repository root used for fallback application paths.
 * @returns A layer providing {@link AppBuildImporter}.
 */
export const layer = (
  root: string,
): Layer.Layer<AppBuildImporter, never, BuildProducts | FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    AppBuildImporter,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const products = yield* BuildProducts
      const load: Service["load"] = (request) =>
        Effect.gen(function* () {
          const encoded = yield* fs.readFileString(request.recordPath)
          const parsed = yield* Effect.try({
            try: () => JSON.parse(encoded) as unknown,
            catch: (cause) => new BuildImportError({ request, cause }),
          })
          const record = yield* Schema.decodeUnknownEffect(BuildRecord)(parsed)
          if (record.platform !== request.platform) {
            return yield* new BuildImportError({
              request,
              cause: `build record platform ${record.platform} does not match ${request.platform}`,
            })
          }
          if (!(yield* fs.exists(request.binaryPath))) {
            return yield* new BuildImportError({ request, cause: "native binary does not exist" })
          }
          const binaryHash = yield* products.hash(request.binaryPath)
          if (record.nativeBinaryHash === null || binaryHash !== record.nativeBinaryHash) {
            return yield* new BuildImportError({
              request,
              cause: `native binary hash ${binaryHash} does not match ${record.nativeBinaryHash}`,
            })
          }
          const observations = (yield* Effect.forEach(
            record.artifacts.filter(({ mediaType }) => mediaType === "application/x-ndjson"),
            (artifact) =>
              Effect.gen(function* () {
                const artifactPath = path.join(
                  path.dirname(request.recordPath),
                  path.basename(artifact.path),
                )
                if (!(yield* fs.exists(artifactPath))) {
                  return yield* new BuildImportError({
                    request,
                    cause: `build observation artifact is missing: ${artifactPath}`,
                  })
                }
                const artifactHash = yield* products.hash(artifactPath)
                if (artifactHash !== artifact.hash) {
                  return yield* new BuildImportError({
                    request,
                    cause: `build observation hash ${artifactHash} does not match ${artifact.hash}`,
                  })
                }
                const text = yield* fs.readFileString(artifactPath)
                return yield* Effect.forEach(
                  text.split("\n").filter((line) => line.length > 0),
                  (line) =>
                    Effect.try({
                      try: () => JSON.parse(line) as unknown,
                      catch: (cause) => new BuildImportError({ request, cause }),
                    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ProcessObservationSchema))),
                )
              }),
          )).flat()
          return {
            record,
            workspace: path.dirname(request.binaryPath),
            appDirectory: root,
            output: request.binaryPath,
            expoCli: path.join(root, "node_modules", "expo", "bin", "cli"),
            observations,
          }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildImportError ? cause : new BuildImportError({ request, cause }),
          ),
        )
      return AppBuildImporter.of({ load })
    }),
  )
