import * as BunServices from "@effect/platform-bun/BunServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { writeGeneratedOutputs } from "./registry/AppRegistry.ts"

describe("generated output synchronization", () => {
  it.effect("removes obsolete files and leaves exactly the allowed output set", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-generated-" })
      yield* fs.writeFileString(`${directory}/obsolete.ts`, "obsolete")
      yield* writeGeneratedOutputs(
        directory,
        new Map([
          ["RegistryMetadata.json", "metadata"],
          ["RunnerPlanLedger.json", "plans"],
        ]),
      )
      assert.deepEqual((yield* fs.readDirectory(directory)).toSorted(), [
        "RegistryMetadata.json",
        "RunnerPlanLedger.json",
      ])
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  )

  it.effect("rejects an obsolete non-file entry instead of deleting it recursively", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-generated-" })
      yield* fs.makeDirectory(`${directory}/obsolete-directory`)
      const failure = yield* writeGeneratedOutputs(directory, new Map()).pipe(Effect.flip)
      assert.match(String(failure.cause), /not a regular file/)
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  )
})
