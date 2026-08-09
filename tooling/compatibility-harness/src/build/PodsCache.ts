import { randomUUID } from "node:crypto"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import { isSafePathSegment } from "../Domain.ts"
import { BuildPipelineError, type BuildRequest } from "./BuildModel.ts"
import { BuildProducts } from "./BuildProducts.ts"

interface PodsCacheRequest {
  readonly request: BuildRequest
  readonly iosDirectory: string
  readonly workspaceRoot: string
  readonly architecture: string
  readonly toolchainFingerprint: string
}

export interface PodsCacheResult {
  readonly hit: boolean
  readonly key: string
  readonly detail: string
}

interface PodsCacheRecord {
  readonly schemaVersion: 2
  readonly architecture: string
  readonly toolchainFingerprint: string
  readonly inputsHash: string
  readonly lockHash: string
}

interface Service {
  readonly restore: (input: PodsCacheRequest) => Effect.Effect<PodsCacheResult, BuildPipelineError>
  readonly publish: (input: PodsCacheRequest) => Effect.Effect<PodsCacheResult, BuildPipelineError>
}

/** CocoaPods cache keyed by effective inputs and stored by the resulting Podfile.lock hash. */
export class PodsCache extends Context.Service<PodsCache, Service>()(
  "@better-native/compatibility-harness/PodsCache",
) {}

class PodsCacheIdentityError extends Data.TaggedError("PodsCacheIdentityError")<{
  readonly cause: string
}> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Builds the versioned CocoaPods cache service. */
export const layer = (
  root: string,
): Layer.Layer<PodsCache, never, BuildProducts | FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    PodsCache,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const products = yield* BuildProducts
      const cacheRoot = path.join(root, ".artifacts", "pods-cache", "v2")
      const entriesRoot = path.join(cacheRoot, "entries")
      const indexesRoot = path.join(cacheRoot, "indexes")
      const cacheLock = `${cacheRoot}.lock`

      const withCacheLock = <A, E>(onBusy: A, effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
        Effect.acquireUseRelease(
          fs.makeDirectory(path.dirname(cacheLock), { recursive: true }).pipe(
            Effect.andThen(Effect.sync(randomUUID)),
            Effect.flatMap((token) =>
              fs.writeFileString(cacheLock, token, { flag: "wx" }).pipe(Effect.as(token)),
            ),
            Effect.orElseSucceed(() => null),
          ),
          (token) => (token === null ? Effect.succeed(onBusy) : effect),
          (token) =>
            token === null
              ? Effect.void
              : fs.readFileString(cacheLock).pipe(
                  Effect.flatMap((current) =>
                    current === token ? fs.remove(cacheLock) : Effect.void,
                  ),
                  Effect.ignore,
                ),
        )

      const digestText = (text: string) => products.digest(new TextEncoder().encode(text))
      const inputsHash = (input: PodsCacheRequest) =>
        Effect.gen(function* () {
          const fragments: Array<readonly [string, string]> = []
          for (const name of ["Podfile", "Podfile.properties.json"]) {
            const target = path.join(input.iosDirectory, name)
            if (yield* fs.exists(target)) {
              fragments.push([
                name,
                (yield* fs.readFileString(target)).replaceAll(input.workspaceRoot, "$WORKSPACE"),
              ])
            }
          }
          return yield* digestText(JSON.stringify(fragments))
        })
      const indexKey = (input: PodsCacheRequest, hash: string) =>
        `${input.architecture}-${input.toolchainFingerprint}-${hash}`
      const lockHash = (iosDirectory: string) =>
        fs.readFileString(path.join(iosDirectory, "Podfile.lock")).pipe(Effect.flatMap(digestText))

      const decodeRecord = (text: string): PodsCacheRecord | null => {
        try {
          const value = JSON.parse(text) as unknown
          if (
            !isRecord(value) ||
            value.schemaVersion !== 2 ||
            typeof value.architecture !== "string" ||
            typeof value.toolchainFingerprint !== "string" ||
            typeof value.inputsHash !== "string" ||
            typeof value.lockHash !== "string"
          )
            return null
          return value as unknown as PodsCacheRecord
        } catch {
          return null
        }
      }

      const restoreUnlocked: Service["restore"] = (input) =>
        Effect.gen(function* () {
          const hash = yield* inputsHash(input)
          const key = indexKey(input, hash)
          if (!isSafePathSegment(key))
            return yield* new PodsCacheIdentityError({
              cause: `invalid CocoaPods cache key: ${key}`,
            })
          const indexPath = path.join(indexesRoot, `${key}.json`)
          if (!(yield* fs.exists(indexPath)))
            return { hit: false, key, detail: "effective CocoaPods input index is missing" }
          const index = decodeRecord(yield* fs.readFileString(indexPath))
          if (
            index === null ||
            index.inputsHash !== hash ||
            index.architecture !== input.architecture ||
            index.toolchainFingerprint !== input.toolchainFingerprint
          ) {
            return { hit: false, key, detail: "effective CocoaPods input index is malformed" }
          }
          const entryKey = `${input.architecture}-${input.toolchainFingerprint}-${index.lockHash}`
          const entry = path.join(entriesRoot, entryKey)
          if (Option.isSome(yield* fs.readLink(entry).pipe(Effect.option)))
            return { hit: false, key, detail: "linked CocoaPods cache entry was rejected" }
          const cachedPods = path.join(entry, "Pods")
          const cachedLock = path.join(entry, "Podfile.lock")
          if (!(yield* fs.exists(cachedPods)) || !(yield* fs.exists(cachedLock)))
            return { hit: false, key, detail: "CocoaPods cache entry is incomplete" }
          if ((yield* digestText(yield* fs.readFileString(cachedLock))) !== index.lockHash)
            return { hit: false, key, detail: "CocoaPods cache lock hash is invalid" }
          const podsDirectory = path.join(input.iosDirectory, "Pods")
          const podfileLock = path.join(input.iosDirectory, "Podfile.lock")
          if (yield* fs.exists(podsDirectory)) yield* fs.remove(podsDirectory, { recursive: true })
          yield* fs.copy(cachedPods, podsDirectory)
          yield* fs.copyFile(cachedLock, podfileLock)
          const now = new Date()
          yield* fs.utimes(entry, now, now)
          return {
            hit: true,
            key: entryKey,
            detail: "restored Pods by effective inputs and validated Podfile.lock hash",
          }
        }).pipe(
          Effect.mapError(
            (cause) => new BuildPipelineError({ phase: "build", request: input.request, cause }),
          ),
        )

      const publishUnlocked: Service["publish"] = (input) =>
        Effect.gen(function* () {
          const hash = yield* inputsHash(input)
          const resultingLockHash = yield* lockHash(input.iosDirectory)
          const key = indexKey(input, hash)
          const entryKey = `${input.architecture}-${input.toolchainFingerprint}-${resultingLockHash}`
          if (!isSafePathSegment(key) || !isSafePathSegment(entryKey))
            return yield* new PodsCacheIdentityError({ cause: "invalid CocoaPods cache identity" })
          const record: PodsCacheRecord = {
            schemaVersion: 2,
            architecture: input.architecture,
            toolchainFingerprint: input.toolchainFingerprint,
            inputsHash: hash,
            lockHash: resultingLockHash,
          }
          const entry = path.join(entriesRoot, entryKey)
          if (
            (yield* fs.exists(entry)) &&
            Option.isSome(yield* fs.readLink(entry).pipe(Effect.option))
          ) {
            return yield* new PodsCacheIdentityError({
              cause: "refusing linked CocoaPods cache entry",
            })
          }
          const existingLock = path.join(entry, "Podfile.lock")
          const existingValid =
            (yield* fs.exists(path.join(entry, "Pods"))) &&
            (yield* fs.exists(existingLock)) &&
            (yield* digestText(yield* fs.readFileString(existingLock))) === resultingLockHash
          if (!existingValid) {
            const temporary = `${entry}.tmp-${process.pid}`
            if (yield* fs.exists(temporary)) yield* fs.remove(temporary, { recursive: true })
            yield* fs.makeDirectory(temporary, { recursive: true })
            yield* fs.copy(path.join(input.iosDirectory, "Pods"), path.join(temporary, "Pods"))
            yield* fs.copyFile(
              path.join(input.iosDirectory, "Podfile.lock"),
              path.join(temporary, "Podfile.lock"),
            )
            yield* fs.writeFileString(
              path.join(temporary, "record.json"),
              `${JSON.stringify(record, null, 2)}\n`,
            )
            yield* fs.makeDirectory(entriesRoot, { recursive: true })
            if (yield* fs.exists(entry)) yield* fs.remove(entry, { recursive: true })
            yield* fs.rename(temporary, entry)
          }
          yield* fs.makeDirectory(indexesRoot, { recursive: true })
          const indexPath = path.join(indexesRoot, `${key}.json`)
          const temporaryIndex = `${indexPath}.tmp-${process.pid}`
          yield* fs.writeFileString(temporaryIndex, `${JSON.stringify(record, null, 2)}\n`)
          if (yield* fs.exists(indexPath)) yield* fs.remove(indexPath)
          yield* fs.rename(temporaryIndex, indexPath)
          const now = new Date()
          yield* fs.utimes(entry, now, now)
          return {
            hit: false,
            key: entryKey,
            detail: "published Pods under validated Podfile.lock identity",
          }
        }).pipe(
          Effect.mapError(
            (cause) => new BuildPipelineError({ phase: "evidence", request: input.request, cause }),
          ),
        )

      const restore: Service["restore"] = (input) =>
        withCacheLock(
          {
            hit: false,
            key: "busy",
            detail: "CocoaPods cache is busy",
          },
          restoreUnlocked(input),
        )
      const publish: Service["publish"] = (input) =>
        withCacheLock(
          {
            hit: false,
            key: "busy",
            detail: "CocoaPods cache is busy; publication skipped",
          },
          publishUnlocked(input),
        )

      return PodsCache.of({ restore, publish })
    }),
  )
