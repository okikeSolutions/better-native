import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
import ts from "typescript"
import { HarnessError } from "../HarnessError.ts"
import type { PackageResolution } from "../Domain.ts"

export const BunLock = Schema.Struct({
  packages: Schema.Record(Schema.String, Schema.Array(Schema.Json)),
})

export type BunLock = Schema.Schema.Type<typeof BunLock>

const failure = (operation: string, path: string, cause: unknown): HarnessError =>
  new HarnessError({ operation, path, cause })

export const read = Effect.fn("BunLock.read")(function* (lockPath: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs
    .readFileString(lockPath)
    .pipe(Effect.mapError((cause) => failure("read Bun lockfile", lockPath, cause)))
  const parsed = yield* Effect.try({
    try: () => ts.parseConfigFileTextToJson(lockPath, text),
    catch: (cause) => failure("parse Bun lockfile", lockPath, cause),
  })
  if (parsed.error !== undefined) {
    return yield* failure("parse Bun lockfile", lockPath, parsed.error)
  }
  return yield* Schema.decodeUnknownEffect(BunLock)(parsed.config).pipe(
    Effect.mapError((cause) => failure("decode Bun lockfile", lockPath, cause)),
  )
})

export const resolution = (
  lock: BunLock,
  name: string,
  version: string,
): PackageResolution | null => {
  for (const value of Object.values(lock.packages)) {
    const [identifier] = value
    if (typeof identifier !== "string" || identifier !== `${name}@${version}`) continue
    const integrity = value.findLast(
      (entry): entry is string => typeof entry === "string" && entry.startsWith("sha"),
    )
    return { version, integrity: integrity ?? null }
  }
  return null
}
