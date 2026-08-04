import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
import { EvidenceError, EvidenceStore, layer } from "./EvidenceStore.ts"

const Record = Schema.Struct({ schemaVersion: Schema.Literal(1), value: Schema.String })

describe("EvidenceStore", () => {
  it.effect("publishes hashed evidence atomically and keeps it immutable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-evidence-" })
      const program = Effect.gen(function* () {
        const store = yield* EvidenceStore
        const first = yield* store.writeJson("runs", "run-1", "record.json", Record, {
          schemaVersion: 1,
          value: "stable",
        })
        const repeated = yield* store.writeJson("runs", "run-1", "record.json", Record, {
          schemaVersion: 1,
          value: "stable",
        })
        assert.strictEqual(first.hash, repeated.hash)
        assert.match(first.path, /^\.artifacts\/runs\/run-1\/record\.json$/)
        const failure = yield* store
          .writeJson("runs", "run-1", "record.json", Record, {
            schemaVersion: 1,
            value: "mutated",
          })
          .pipe(Effect.flip)
        assert.instanceOf(failure, EvidenceError)
        assert.strictEqual(failure.operation, "preserve immutable evidence")
      }).pipe(Effect.provide(layer(root)))
      yield* program
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect("rejects evidence directories redirected through symbolic links", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-evidence-root-" })
      const outside = yield* fs.makeTempDirectoryScoped({
        prefix: "better-native-evidence-outside-",
      })
      yield* fs.makeDirectory(`${root}/.artifacts/runs`, { recursive: true })
      yield* fs.symlink(outside, `${root}/.artifacts/runs/escaped-run`)
      const failure = yield* Effect.gen(function* () {
        const store = yield* EvidenceStore
        return yield* store.writeJson("runs", "escaped-run", "record.json", Record, {
          schemaVersion: 1,
          value: "must stay inside root",
        })
      }).pipe(Effect.provide(layer(root)), Effect.flip)
      assert.instanceOf(failure, EvidenceError)
      assert.strictEqual(failure.operation, "validate evidence directory")
      assert.isFalse(yield* fs.exists(`${outside}/record.json`))
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
