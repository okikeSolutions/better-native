import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { ContentHash, type ContentHash as ContentHashType } from "../Domain.ts"

interface Service {
  readonly digest: (bytes: Uint8Array) => Effect.Effect<ContentHashType, unknown>
  readonly hash: (path: string) => Effect.Effect<ContentHashType, unknown>
}

/** Effect context tag for canonical build-product hashing. */
export class BuildProducts extends Context.Service<BuildProducts, Service>()(
  "@better-native/compatibility-harness/BuildProducts",
) {}

/**
 * Builds product hashing with symlink rejection and deterministic directory traversal.
 *
 * @returns A layer providing {@link BuildProducts}.
 */
export const layer: Layer.Layer<
  BuildProducts,
  never,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto
> = Layer.effect(
  BuildProducts,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const crypto = yield* Crypto.Crypto
    const digest: Service["digest"] = (bytes) =>
      crypto
        .digest("SHA-256", bytes)
        .pipe(Effect.map((value) => ContentHash.make(Encoding.encodeHex(value))))
    const hash: Service["hash"] = (target) =>
      Effect.gen(function* () {
        const canonicalParent = yield* fs.realPath(path.dirname(target))
        const expectedRoot = path.join(canonicalParent, path.basename(target))
        const canonicalRoot = yield* fs.realPath(target)
        if (canonicalRoot !== expectedRoot) {
          return yield* Effect.fail(
            `refusing symbolic-link build product ${target} -> ${canonicalRoot}`,
          )
        }
        const rootInfo = yield* fs.stat(canonicalRoot)
        if (rootInfo.type === "File") return yield* digest(yield* fs.readFile(canonicalRoot))
        if (rootInfo.type !== "Directory") {
          return yield* Effect.fail(`unsupported build product type ${rootInfo.type}`)
        }
        const entries: Array<string> = []
        const visit = (current: string): Effect.Effect<void, unknown> =>
          Effect.gen(function* () {
            for (const name of (yield* fs.readDirectory(current)).toSorted()) {
              const absolute = path.join(current, name)
              const canonical = yield* fs.realPath(absolute)
              if (canonical !== absolute) {
                return yield* Effect.fail(
                  `refusing symbolic link in build product ${absolute} -> ${canonical}`,
                )
              }
              const info = yield* fs.stat(canonical)
              if (info.type === "Directory") {
                yield* visit(canonical)
              } else if (info.type === "File") {
                const fileHash = yield* digest(yield* fs.readFile(canonical))
                entries.push(`${path.relative(canonicalRoot, canonical)}\0${fileHash}`)
              } else {
                return yield* Effect.fail(
                  `unsupported build product entry ${absolute} (${info.type})`,
                )
              }
            }
            return undefined
          })
        yield* visit(canonicalRoot)
        return yield* digest(new TextEncoder().encode(entries.join("\n")))
      })
    return BuildProducts.of({ digest, hash })
  }),
)
