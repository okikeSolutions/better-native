import * as SqliteClient from "@better-native/sqlite/client"
import { sqliteClientAtom } from "@better-native/sqlite/sqlite"
import * as Effect from "effect/Effect"
import * as Data from "effect/Data"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

export const name = "SQLite Effect capability"

interface JasmineApi {
  readonly describe: (name: string, spec: () => void) => void
  readonly it: (name: string, spec: () => Promise<void>) => void
}

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const databaseName = "better-native-sqlite-capability.db"
class Rollback extends Data.TaggedError("SQLiteCapabilityRollback") {}
/* oxlint-disable effecttsgo/strict-effect-provide -- compatibility capability entry point */
const run = <A, E>(effect: Effect.Effect<A, E, SqliteClient.SqliteClient | SqlClient.SqlClient>) =>
  Effect.runPromise(
    Effect.scoped(effect.pipe(Effect.provide(SqliteClient.layer({ databaseName })))),
  )
/* oxlint-enable effecttsgo/strict-effect-provide */

export function test({ describe, it }: JasmineApi): void {
  describe(name, () => {
    it("runs tagged reads and parameterized writes through the live client", async () => {
      const value = await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`CREATE TABLE IF NOT EXISTS capability_values (value TEXT NOT NULL)`
          yield* sql`DELETE FROM capability_values`
          yield* sql`INSERT INTO capability_values (value) VALUES (${"effect-sqlite"})`
          const rows = yield* sql<{ readonly value: string }>`SELECT value FROM capability_values`
          return rows[0]?.value
        }),
      )
      assert(value === "effect-sqlite", "Effect SQLite client did not round-trip the value")
    })

    it("rolls back an interrupted transaction", async () => {
      const count = await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`CREATE TABLE IF NOT EXISTS capability_rollback (value TEXT NOT NULL)`
          yield* sql`DELETE FROM capability_rollback`
          yield* sql
            .withTransaction(
              sql`INSERT INTO capability_rollback (value) VALUES (${"discarded"})`.pipe(
                Effect.andThen(Effect.fail(new Rollback())),
              ),
            )
            .pipe(Effect.catch(() => Effect.void))
          const rows = yield* sql<{
            readonly count: number
          }>`SELECT COUNT(*) AS count FROM capability_rollback`
          return rows[0]?.count ?? -1
        }),
      )
      assert(count === 0, "Interrupted transaction was not rolled back")
    })

    it("opens and releases the Effect SQLite atom", async () => {
      const atom = sqliteClientAtom({ databaseName })
      const registry = AtomRegistry.make()
      const release = registry.mount(atom)
      try {
        const result = registry.get(atom) as AsyncResult.AsyncResult<unknown, unknown>
        assert(!AsyncResult.isFailure(result), "SQLite client atom failed to open")
      } finally {
        release()
      }
    })
  })
}
