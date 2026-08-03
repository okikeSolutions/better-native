import * as BunServices from "@effect/platform-bun/BunServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
import { AppWorkspace, layer } from "./AppWorkspace.ts"

const request = {
  id: "fixture-isolation",
  mode: "upstream" as const,
  platform: "ios" as const,
  expoRevision: "1".repeat(40),
  candidateRevision: null,
  timeoutMillis: 1_000,
}

const FixtureManifest = Schema.Struct({
  name: Schema.String,
  expo: Schema.Struct({ autolinking: Schema.Struct({ exclude: Schema.Array(Schema.String) }) }),
})

describe("AppWorkspace", () => {
  it.effect("preserves fixture autolinking instead of injecting global module search paths", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-fixture-" })
      for (const directory of ["apps/compatibility-suite", "node_modules", "packages", "vendor"]) {
        yield* fs.makeDirectory(`${root}/${directory}`, { recursive: true })
      }
      const sourceManifest = {
        name: "fixture",
        expo: { autolinking: { exclude: ["known-incompatible-module"] } },
      }
      yield* fs.writeFileString(
        `${root}/apps/compatibility-suite/package.json`,
        `${JSON.stringify(sourceManifest)}\n`,
      )

      const prepared = yield* Effect.gen(function* () {
        const workspace = yield* AppWorkspace
        return yield* workspace.prepare(request)
      }).pipe(Effect.provide(layer(root)))
      const materialized = yield* Schema.decodeUnknownEffect(FixtureManifest)(
        JSON.parse(yield* fs.readFileString(`${prepared.appDirectory}/package.json`)) as unknown,
      )

      assert.deepStrictEqual(materialized, sourceManifest)
      assert.notProperty(materialized.expo.autolinking, "searchPaths")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  )
})
