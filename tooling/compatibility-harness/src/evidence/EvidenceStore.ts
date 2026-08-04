import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { ArtifactId, ContentHash, isSafePathSegment, type Artifact } from "../Domain.ts"

export class EvidenceError extends Data.TaggedError("EvidenceError")<{
  readonly operation: string
  readonly path: string
  readonly cause: unknown
}> {}

export interface Service {
  readonly writeBytes: (
    collection: "builds" | "runs",
    recordId: string,
    name: string,
    mediaType: string,
    bytes: Uint8Array,
  ) => Effect.Effect<Artifact, EvidenceError>
  readonly writeJson: <A>(
    collection: "builds" | "runs",
    recordId: string,
    name: string,
    schema: Schema.Schema<A> & { readonly EncodingServices: never },
    value: A,
  ) => Effect.Effect<Artifact, EvidenceError>
}

export class EvidenceStore extends Context.Service<EvidenceStore, Service>()(
  "@better-native/compatibility-harness/EvidenceStore",
) {}

export const layer = (
  root: string,
): Layer.Layer<EvidenceStore, never, FileSystem.FileSystem | Path.Path | Crypto.Crypto> =>
  Layer.effect(
    EvidenceStore,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const crypto = yield* Crypto.Crypto
      const canonicalRoot = yield* fs.realPath(root).pipe(Effect.orDie)
      const fail = (operation: string, target: string, cause: unknown) =>
        new EvidenceError({ operation, path: target, cause })
      const hash = (bytes: Uint8Array) =>
        crypto.digest("SHA-256", bytes).pipe(
          Effect.map((digest) => ContentHash.make(Encoding.encodeHex(digest))),
          Effect.mapError((cause) => fail("hash evidence", root, cause)),
        )
      const ensureCanonical = (operation: string, target: string) =>
        fs.realPath(target).pipe(
          Effect.flatMap((canonical) =>
            canonical === path.resolve(canonicalRoot, path.relative(root, target))
              ? Effect.void
              : Effect.fail(fail(operation, target, `symbolic-link path resolves to ${canonical}`)),
          ),
          Effect.mapError((cause) =>
            cause instanceof EvidenceError ? cause : fail(operation, target, cause),
          ),
        )
      const writeBytes: Service["writeBytes"] = (collection, recordId, name, mediaType, bytes) =>
        Effect.gen(function* () {
          if (!isSafePathSegment(recordId) || !isSafePathSegment(name)) {
            return yield* fail(
              "validate evidence path",
              `${collection}/${recordId}/${name}`,
              "record ID and artifact name must be safe path segments",
            )
          }
          const directory = path.join(root, ".artifacts", collection, recordId)
          const target = path.join(directory, name)
          yield* fs
            .makeDirectory(directory, { recursive: true })
            .pipe(Effect.mapError((cause) => fail("create evidence directory", directory, cause)))
          yield* ensureCanonical("validate evidence directory", directory)
          const contentHash = yield* hash(bytes)
          if (
            yield* fs
              .exists(target)
              .pipe(Effect.mapError((cause) => fail("inspect evidence", target, cause)))
          ) {
            yield* ensureCanonical("validate evidence target", target)
            const existing = yield* fs
              .readFile(target)
              .pipe(Effect.mapError((cause) => fail("read existing evidence", target, cause)))
            const existingHash = yield* hash(existing)
            if (existingHash !== contentHash) {
              return yield* fail(
                "preserve immutable evidence",
                target,
                `existing hash ${existingHash} differs from ${contentHash}`,
              )
            }
          } else {
            const temporary = yield* fs
              .makeTempFile({ directory, prefix: `.${name}.`, suffix: ".tmp" })
              .pipe(Effect.mapError((cause) => fail("create temporary evidence", target, cause)))
            yield* fs
              .writeFile(temporary, bytes)
              .pipe(Effect.mapError((cause) => fail("write temporary evidence", temporary, cause)))
            yield* fs
              .rename(temporary, target)
              .pipe(Effect.mapError((cause) => fail("publish evidence", target, cause)))
          }
          return {
            id: ArtifactId.make(`${collection}/${recordId}/${name}@${contentHash}`),
            path: path.relative(root, target),
            mediaType,
            size: bytes.byteLength,
            hash: contentHash,
          }
        })
      return EvidenceStore.of({
        writeBytes,
        writeJson: (collection, recordId, name, schema, value) =>
          Schema.encodeEffect(schema)(value).pipe(
            Effect.map((encoded) =>
              new TextEncoder().encode(`${JSON.stringify(encoded, null, 2)}\n`),
            ),
            Effect.mapError((cause) => fail("encode evidence", name, cause)),
            Effect.flatMap((bytes) =>
              writeBytes(collection, recordId, name, "application/json", bytes),
            ),
          ),
      })
    }),
  )
