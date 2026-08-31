import * as SqliteClient from "@better-native/sqlite/client"
import { addDatabaseChangeListener, sqliteClientAtom } from "@better-native/sqlite/sqlite"
import * as Effect from "effect/Effect"
import * as Data from "effect/Data"
import * as ExpoSQLite from "expo-sqlite"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { Platform } from "react-native"

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

      const expoDatabase = await ExpoSQLite.openDatabaseAsync(databaseName)
      try {
        const rows = await expoDatabase.getAllAsync<{ readonly value: string }>(
          "SELECT value FROM capability_values",
        )
        assert(rows[0]?.value === value, "Expo did not observe the Effect SQLite write")
      } finally {
        await expoDatabase.closeAsync()
      }
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

    it("streams native database changes with scoped listener cleanup", async () => {
      if (Platform.OS === "web") {
        assert(
          typeof ExpoSQLite.addDatabaseChangeListener === "function",
          "Expo SQLite change listener was unavailable on web",
        )
        return
      }

      const database = await ExpoSQLite.openDatabaseAsync(databaseName, {
        enableChangeListener: true,
      })
      try {
        await database.execAsync(
          "CREATE TABLE IF NOT EXISTS capability_events (value TEXT NOT NULL)",
        )
        const eventPromise = Effect.runPromise(
          addDatabaseChangeListener.pipe(
            Stream.filter(
              (event) => event.databaseName === "main" && event.tableName === "capability_events",
            ),
            Stream.runHead,
            Effect.timeout("10 seconds"),
          ),
        )
        await Effect.runPromise(Effect.sleep("100 millis"))
        await database.runAsync("INSERT INTO capability_events (value) VALUES (?)", "effect-event")
        const event = await eventPromise
        assert(Option.isSome(event), "Effect SQLite change stream completed without an event")
        assert(event.value.rowId > 0, "Effect SQLite change event did not include a row ID")
      } finally {
        await database.closeAsync()
      }
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
