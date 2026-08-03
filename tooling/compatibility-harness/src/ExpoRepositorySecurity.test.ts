import * as BunServices from "@effect/platform-bun/BunServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { ExpoRepository, Upstreams, layer } from "./ExpoRepository.ts"
import { HarnessError } from "./HarnessError.ts"

describe("ExpoRepository path boundaries", () => {
  it.effect("rejects absolute and parent-relative repository paths", () =>
    Effect.gen(function* () {
      const repository = yield* ExpoRepository
      const readFailure = yield* repository
        .readJson("../package.json", Schema.Unknown)
        .pipe(Effect.flip)
      assert.instanceOf(readFailure, HarnessError)
      assert.strictEqual(readFailure.operation, "resolve repository JSON")

      const writeFailure = yield* repository
        .writeArtifact("../../outside.json", "{}")
        .pipe(Effect.flip)
      assert.instanceOf(writeFailure, HarnessError)
      assert.strictEqual(writeFailure.operation, "resolve artifact path")
    }).pipe(Effect.provide(layer(process.cwd()).pipe(Layer.provideMerge(BunServices.layer)))),
  )

  it.effect("rejects unsafe upstream revisions and paths during decoding", () =>
    Effect.gen(function* () {
      for (const invalid of [
        {
          repository: "https://example.invalid/expo.git",
          revision: "../../outside",
        },
        {
          repository: "https://example.invalid/expo.git",
          revision: "1".repeat(39),
        },
      ]) {
        const result = yield* Schema.decodeUnknownEffect(Upstreams)({
          schemaVersion: 1,
          effect: {
            repository: "https://example.invalid/effect.git",
            revision: "2".repeat(40),
            path: "vendor/effect",
          },
          expo: invalid,
        }).pipe(Effect.result)
        assert.strictEqual(result._tag, "Failure")
      }
    }),
  )

  it.effect("rejects symbolic-link artifact directories and targets", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-repository-" })
      const outside = yield* fs.makeTempDirectoryScoped({
        prefix: "better-native-artifact-outside-",
      })
      yield* fs.makeDirectory(`${root}/compatibility`, { recursive: true })
      yield* fs.makeDirectory(`${root}/expo-source`, { recursive: true })
      yield* fs.makeDirectory(`${root}/vendor/effect`, { recursive: true })
      yield* fs.writeFileString(
        `${root}/compatibility/upstreams.json`,
        JSON.stringify({
          schemaVersion: 1,
          effect: {
            repository: "https://example.invalid/effect.git",
            revision: "2".repeat(40),
            path: "vendor/effect",
          },
          expo: {
            repository: "https://example.invalid/expo.git",
            revision: "1".repeat(40),
          },
        }),
      )
      yield* fs.makeDirectory(`${root}/.artifacts`, { recursive: true })
      yield* fs.symlink(outside, `${root}/.artifacts/compatibility`)
      const directoryFailure = yield* Effect.gen(function* () {
        const repository = yield* ExpoRepository
        return yield* repository.writeArtifact("compatibility/catalog.json", "{}").pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          layer(root, `${root}/expo-source`).pipe(Layer.provideMerge(BunServices.layer)),
        ),
      )
      assert.instanceOf(directoryFailure, HarnessError)
      assert.strictEqual(directoryFailure.operation, "validate artifact directory")

      yield* fs.remove(`${root}/.artifacts/compatibility`)
      yield* fs.makeDirectory(`${root}/.artifacts/compatibility`)
      yield* fs.writeFileString(`${outside}/catalog.json`, "outside")
      yield* fs.symlink(`${outside}/catalog.json`, `${root}/.artifacts/compatibility/catalog.json`)
      const targetFailure = yield* Effect.gen(function* () {
        const repository = yield* ExpoRepository
        return yield* repository.writeArtifact("compatibility/catalog.json", "{}").pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          layer(root, `${root}/expo-source`).pipe(Layer.provideMerge(BunServices.layer)),
        ),
      )
      assert.instanceOf(targetFailure, HarnessError)
      assert.strictEqual(targetFailure.operation, "validate artifact target")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  )
})
