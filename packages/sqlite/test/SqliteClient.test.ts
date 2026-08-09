import { describe, expect, it, vi } from "vitest"
import * as Cause from "effect/Cause"
import * as Config from "effect/Config"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { SqlError } from "effect/unstable/sql/SqlError"

const mocks = vi.hoisted(() => ({
  addDatabaseChangeListener: vi.fn(),
  backupDatabaseAsync: vi.fn(),
  backupDatabaseSync: vi.fn(),
  deleteDatabaseAsync: vi.fn(),
  deleteDatabaseSync: vi.fn(),
  deserializeDatabaseAsync: vi.fn(),
  deserializeDatabaseSync: vi.fn(),
  importDatabaseFromAssetAsync: vi.fn(),
  openDatabaseAsync: vi.fn(),
  openDatabaseSync: vi.fn(),
}))

vi.mock("expo-sqlite", () => ({
  SQLiteDatabase: class SQLiteDatabase {},
  SQLiteProvider: vi.fn(),
  SQLiteSession: class SQLiteSession {},
  SQLiteStatement: class SQLiteStatement {},
  SQLiteTaggedQuery: class SQLiteTaggedQuery {},
  addDatabaseChangeListener: mocks.addDatabaseChangeListener,
  backupDatabaseAsync: mocks.backupDatabaseAsync,
  backupDatabaseSync: mocks.backupDatabaseSync,
  bundledExtensions: {},
  deepEqual: vi.fn(),
  defaultDatabaseDirectory: "/sqlite",
  deleteDatabaseAsync: mocks.deleteDatabaseAsync,
  deleteDatabaseSync: mocks.deleteDatabaseSync,
  deserializeDatabaseAsync: mocks.deserializeDatabaseAsync,
  deserializeDatabaseSync: mocks.deserializeDatabaseSync,
  importDatabaseFromAssetAsync: mocks.importDatabaseFromAssetAsync,
  openDatabaseAsync: mocks.openDatabaseAsync,
  openDatabaseSync: mocks.openDatabaseSync,
  useSQLiteContext: vi.fn(),
}))

const { SQLite, SqliteClient, SqliteMigrator } = await import("../src/index")

const provideLayer =
  <ROut, E2, RIn>(layer: Layer.Layer<ROut, E2, RIn>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | E2, RIn | Exclude<R, ROut>> =>
    Effect.scoped(
      Layer.build(layer).pipe(Effect.flatMap((context) => Effect.provide(effect, context))),
    )

const makeDatabase = () => ({
  databasePath: "/sqlite/test.db",
  closeAsync: vi.fn(async () => undefined),
  getAllAsync: vi.fn(async () => [{ id: 1, user_name: "Ada" }]),
  getEachAsync: vi.fn(() =>
    (async function* () {
      yield { id: 1 }
      yield { id: 2 }
    })(),
  ),
  loadExtensionAsync: vi.fn(async () => undefined),
  prepareAsync: vi.fn(async () => ({
    executeAsync: vi.fn(async () => ({
      changes: 1,
      getAllAsync: vi.fn(async () => [{ id: 1, user_name: "Ada" }]),
      lastInsertRowId: 1,
    })),
    executeForRawResultAsync: vi.fn(async () => ({
      getAllAsync: vi.fn(async () => [[1, "Ada"]]),
    })),
    finalizeAsync: vi.fn(async () => undefined),
    getColumnNamesAsync: vi.fn(async () => []),
  })),
  serializeAsync: vi.fn(async () => new Uint8Array([1, 2, 3])),
  syncLibSQL: vi.fn(async () => undefined),
})

describe("@better-native/sqlite", () => {
  it("provides Effect's generic SqlClient and compiles tagged-template parameters", async () => {
    const database = makeDatabase()
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)

    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly id: number }>`SELECT id FROM users WHERE id = ${1}`
      }).pipe(provideLayer(SqliteClient.layer({ databaseName: "test.db" }))),
    )

    expect(rows).toEqual([{ id: 1, user_name: "Ada" }])
    expect(database.getAllAsync).toHaveBeenCalledWith("SELECT id FROM users WHERE id = ?", [1])
    expect(database.closeAsync).toHaveBeenCalledOnce()
  })

  it("supports Effect SQL result-name transforms", async () => {
    const database = makeDatabase()
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)

    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqliteClient.SqliteClient
        return yield* sql<{ readonly userName: string }>`SELECT user_name FROM users`
      }).pipe(
        provideLayer(
          SqliteClient.layer({
            databaseName: "test.db",
            transformResultNames: (name) =>
              name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
          }),
        ),
      ),
    )

    expect(rows).toEqual([{ id: 1, userName: "Ada" }])
  })

  it("uses Effect SQL's nested, interruption-safe transaction implementation", async () => {
    const database = makeDatabase()
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)

    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqliteClient.SqliteClient
        yield* sql.withTransaction(sql.withTransaction(sql`INSERT INTO users (id) VALUES (${1})`))

        const started = yield* Deferred.make<void>()
        const fiber = yield* sql
          .withTransaction(Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))
          .pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* Fiber.interrupt(fiber)
      }).pipe(provideLayer(SqliteClient.layer({ databaseName: "test.db" }))),
    )

    const statements = (database.getAllAsync.mock.calls as unknown as Array<[string]>).map(
      ([sql]) => sql,
    )
    expect(statements).toEqual([
      "BEGIN",
      "SAVEPOINT effect_sql_1",
      "INSERT INTO users (id) VALUES (?)",
      "COMMIT",
      "BEGIN",
      "ROLLBACK",
    ])
  })

  it("streams through Effect SQL", async () => {
    const database = makeDatabase()
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)

    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqliteClient.SqliteClient
        return yield* sql<{ readonly id: number }>`SELECT id FROM users`.stream.pipe(
          Stream.runCollect,
          Effect.map(Array.from),
        )
      }).pipe(provideLayer(SqliteClient.layer({ databaseName: "test.db" }))),
    )

    expect(rows).toEqual([{ id: 1 }, { id: 2 }])
  })

  it("preserves Effect SQL raw mutation metadata and query rows", async () => {
    const database = makeDatabase()
    const mutation = {
      executeAsync: vi.fn(async () => ({
        changes: 1,
        getAllAsync: vi.fn(async () => []),
        lastInsertRowId: 7,
      })),
      finalizeAsync: vi.fn(async () => undefined),
      getColumnNamesAsync: vi.fn(async () => []),
    }
    const query = {
      executeAsync: vi.fn(async () => ({
        changes: 0,
        getAllAsync: vi.fn(async () => [{ id: 7, user_name: "Ada" }]),
        lastInsertRowId: 7,
      })),
      finalizeAsync: vi.fn(async () => undefined),
      getColumnNamesAsync: vi.fn(async () => ["id", "user_name"]),
    }
    database.prepareAsync
      .mockImplementationOnce(() => Promise.resolve(mutation as never))
      .mockImplementationOnce(() => Promise.resolve(query as never))
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqliteClient.SqliteClient
        const inserted = yield* sql`INSERT INTO users (name) VALUES (${"Ada"})`.raw
        const rows = yield* sql`SELECT id, user_name FROM users`.raw
        return { inserted, rows }
      }).pipe(provideLayer(SqliteClient.layer({ databaseName: "test.db" }))),
    )

    expect(result).toEqual({
      inserted: { changes: 1, lastInsertRowid: 7 },
      rows: [{ id: 7, user_name: "Ada" }],
    })
    expect(mutation.executeAsync).toHaveBeenCalledWith(["Ada"])
    expect(mutation.finalizeAsync).toHaveBeenCalledOnce()
    expect(query.finalizeAsync).toHaveBeenCalledOnce()
  })

  it("exposes Expo-specific export, extension, and libSQL operations", async () => {
    const database = makeDatabase()
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)

    const bytes = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqliteClient.SqliteClient
        yield* sql.loadExtension("/extensions/vec", "sqlite3_vec_init")
        yield* sql.syncLibSQL
        return yield* sql.export
      }).pipe(provideLayer(SqliteClient.layer({ databaseName: "test.db" }))),
    )

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(database.loadExtensionAsync).toHaveBeenCalledWith("/extensions/vec", "sqlite3_vec_init")
    expect(database.syncLibSQL).toHaveBeenCalledOnce()
  })

  it("installs and removes Expo change listeners with the client scope", async () => {
    const database = makeDatabase()
    const remove = vi.fn()
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)
    mocks.addDatabaseChangeListener.mockImplementationOnce((listener) => {
      listener({
        databaseFilePath: "/sqlite/other.db",
        databaseName: "other",
        tableName: "ignored",
        rowId: 1,
      })
      listener({
        databaseFilePath: database.databasePath,
        databaseName: "main",
        tableName: "users",
        rowId: 2,
      })
      return { remove }
    })

    await Effect.runPromise(
      Effect.void.pipe(
        provideLayer(
          SqliteClient.layer({
            databaseName: "test.db",
            openOptions: { enableChangeListener: true },
          }),
        ),
      ),
    )

    expect(mocks.openDatabaseAsync).toHaveBeenCalledWith(
      "test.db",
      { enableChangeListener: true },
      undefined,
    )
    expect(mocks.addDatabaseChangeListener).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
  })

  it("maps Expo failures into Effect's classified SqlError", async () => {
    const database = makeDatabase()
    const nativeCause = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" })
    database.getAllAsync.mockRejectedValueOnce(nativeCause)
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const sql = yield* SqliteClient.SqliteClient
        return yield* sql`SELECT 1`
      }).pipe(provideLayer(SqliteClient.layer({ databaseName: "test.db" }))),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    const reason = exit.cause.reasons.find(Cause.isFailReason)
    if (reason === undefined || !(reason.error instanceof SqlError)) {
      throw new Error("expected a SqlError")
    }
    expect(reason.error.reason._tag).toBe("LockTimeoutError")
    expect(reason.error.reason.cause).toBe(nativeCause)
  })

  it("wraps database lifecycle operations as scoped Effects", async () => {
    const database = makeDatabase()
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)
    mocks.deleteDatabaseAsync.mockResolvedValueOnce(undefined)
    mocks.importDatabaseFromAssetAsync.mockResolvedValueOnce(undefined)

    const path = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* SQLite.openDatabaseAsync(
            "lifecycle.db",
            { enableChangeListener: true },
            "/sqlite",
          )
          yield* SQLite.importDatabaseFromAssetAsync("asset.db", { assetId: 7 }, "/sqlite")
          yield* SQLite.deleteDatabaseAsync("old.db", "/sqlite")
          return opened.databasePath
        }),
      ),
    )

    expect(path).toBe("/sqlite/test.db")
    expect(mocks.openDatabaseAsync).toHaveBeenCalledWith(
      "lifecycle.db",
      { enableChangeListener: true },
      "/sqlite",
    )
    expect(mocks.importDatabaseFromAssetAsync).toHaveBeenCalledWith(
      "asset.db",
      { assetId: 7 },
      "/sqlite",
    )
    expect(mocks.deleteDatabaseAsync).toHaveBeenCalledWith("old.db", "/sqlite")
    expect(database.closeAsync).toHaveBeenCalledOnce()
  })

  it("forwards sync and deserialize lifecycle operations and closes every scoped handle", async () => {
    const asyncDatabase = makeDatabase()
    const syncDatabase = { databasePath: "/sqlite/sync.db", closeSync: vi.fn() }
    mocks.deserializeDatabaseAsync.mockResolvedValueOnce(asyncDatabase)
    mocks.deserializeDatabaseSync.mockReturnValueOnce(syncDatabase)
    mocks.openDatabaseSync.mockReturnValueOnce(syncDatabase)
    mocks.backupDatabaseAsync.mockResolvedValueOnce(undefined)

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const bytes = new Uint8Array([1, 2])
          yield* SQLite.deserializeDatabaseAsync(bytes, { enableChangeListener: true })
          yield* SQLite.deserializeDatabaseSync(bytes, { useNewConnection: true })
          yield* SQLite.openDatabaseSync("sync.db", { useNewConnection: true }, "/sqlite")
          yield* SQLite.backupDatabaseAsync({
            sourceDatabase: asyncDatabase as never,
            destDatabase: asyncDatabase as never,
          })
          yield* SQLite.backupDatabaseSync({
            sourceDatabase: asyncDatabase as never,
            sourceDatabaseName: "main",
            destDatabase: asyncDatabase as never,
            destDatabaseName: "backup",
          })
          yield* SQLite.deleteDatabaseSync("sync.db", "/sqlite")
        }),
      ),
    )

    expect(mocks.deserializeDatabaseAsync).toHaveBeenCalledWith(new Uint8Array([1, 2]), {
      enableChangeListener: true,
    })
    expect(mocks.deserializeDatabaseSync).toHaveBeenCalledWith(new Uint8Array([1, 2]), {
      useNewConnection: true,
    })
    expect(mocks.openDatabaseSync).toHaveBeenCalledWith(
      "sync.db",
      { useNewConnection: true },
      "/sqlite",
    )
    expect(asyncDatabase.closeAsync).toHaveBeenCalledOnce()
    expect(syncDatabase.closeSync).toHaveBeenCalledTimes(2)
    expect(mocks.backupDatabaseAsync).toHaveBeenCalledOnce()
    expect(mocks.backupDatabaseSync).toHaveBeenCalledOnce()
    expect(mocks.deleteDatabaseSync).toHaveBeenCalledWith("sync.db", "/sqlite")
  })

  it("classifies asynchronous and synchronous lifecycle failures", async () => {
    mocks.backupDatabaseAsync.mockRejectedValueOnce(new Error("backup failed"))
    mocks.deleteDatabaseSync.mockImplementationOnce(() => {
      throw new Error("delete failed")
    })

    const [asyncExit, syncExit] = await Promise.all([
      Effect.runPromiseExit(
        SQLite.backupDatabaseAsync({ sourceDatabase: {} as never, destDatabase: {} as never }),
      ),
      Effect.runPromiseExit(SQLite.deleteDatabaseSync("broken.db")),
    ])

    expect(asyncExit._tag).toBe("Failure")
    expect(syncExit._tag).toBe("Failure")
    if (asyncExit._tag === "Failure") {
      expect(asyncExit.cause.reasons.find(Cause.isFailReason)?.error).toBeInstanceOf(SqlError)
    }
    if (syncExit._tag === "Failure") {
      expect(syncExit.cause.reasons.find(Cause.isFailReason)?.error).toBeInstanceOf(SqlError)
    }
  })

  it("supports values, values-unprepared, unprepared rows, and transformed streams", async () => {
    const database = makeDatabase()
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqliteClient.SqliteClient
        const values = yield* sql`SELECT id, name FROM users`.values
        const valuesUnprepared = yield* sql`SELECT id, name FROM users`.valuesUnprepared
        const rows = yield* sql<{ readonly userName: string }>`SELECT user_name FROM users`
          .unprepared
        const streamed = yield* sql<{
          readonly userName: string
        }>`SELECT user_name FROM users`.stream.pipe(Stream.runCollect, Effect.map(Array.from))
        return { values, valuesUnprepared, rows, streamed }
      }).pipe(
        provideLayer(
          SqliteClient.layer({
            databaseName: "families.db",
            transformResultNames: (name) =>
              name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
          }),
        ),
      ),
    )

    expect(result.values).toEqual([[1, "Ada"]])
    expect(result.valuesUnprepared).toEqual([[1, "Ada"]])
    expect(result.rows).toEqual([{ id: 1, userName: "Ada" }])
    expect(result.streamed).toEqual([{ id: 1 }, { id: 2 }])
    expect(database.prepareAsync).toHaveBeenCalledTimes(2)
  })

  it("classifies prepared, raw, stream, and client extension failures", async () => {
    const database = makeDatabase()
    database.prepareAsync.mockRejectedValueOnce(new Error("prepare values")).mockResolvedValueOnce({
      executeAsync: vi.fn(async () => {
        throw new Error("execute raw")
      }),
      finalizeAsync: vi.fn(async () => undefined),
      getColumnNamesAsync: vi.fn(async () => []),
    } as never)
    database.getEachAsync.mockImplementationOnce(() => {
      throw new Error("stream start")
    })
    database.serializeAsync.mockRejectedValueOnce(new Error("serialize"))
    database.loadExtensionAsync.mockRejectedValueOnce(new Error("extension"))
    database.syncLibSQL.mockRejectedValueOnce(new Error("sync"))
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)

    const exits = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqliteClient.SqliteClient
        return yield* Effect.all(
          [
            Effect.exit(sql`SELECT 1`.values),
            Effect.exit(sql`UPDATE users SET name = 'x'`.raw),
            Effect.exit(sql`SELECT 1`.stream.pipe(Stream.runDrain)),
            Effect.exit(sql.export),
            Effect.exit(sql.loadExtension("bad")),
            Effect.exit(sql.syncLibSQL),
          ],
          { concurrency: 1 },
        )
      }).pipe(provideLayer(SqliteClient.layer({ databaseName: "failures.db" }))),
    )

    expect(exits).toHaveLength(6)
    for (const exit of exits) expect(exit._tag).toBe("Failure")
  })

  it("classifies acquisition and change-listener installation failures", async () => {
    mocks.openDatabaseAsync.mockRejectedValueOnce(new Error("open failed"))
    const openExit = await Effect.runPromiseExit(
      Effect.void.pipe(provideLayer(SqliteClient.layer({ databaseName: "open-failure.db" }))),
    )

    const database = makeDatabase()
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)
    mocks.addDatabaseChangeListener.mockImplementationOnce(() => {
      throw new Error("listener failed")
    })
    const listenerExit = await Effect.runPromiseExit(
      Effect.void.pipe(
        provideLayer(
          SqliteClient.layer({
            databaseName: "listener-failure.db",
            openOptions: { enableChangeListener: true },
          }),
        ),
      ),
    )

    expect(openExit._tag).toBe("Failure")
    expect(listenerExit._tag).toBe("Failure")
    expect(database.closeAsync).toHaveBeenCalledOnce()
  })

  it("classifies statement execution, preparation, iteration, and finalizer failures", async () => {
    const database = makeDatabase()
    const valueExecutionFailure = {
      executeForRawResultAsync: vi.fn(async () => {
        throw new Error("value execution")
      }),
      finalizeAsync: vi.fn(async () => undefined),
    }
    const rawFinalizeFailure = {
      executeAsync: vi.fn(async () => ({ changes: 1, lastInsertRowId: 1 })),
      finalizeAsync: vi.fn(async () => {
        throw new Error("raw finalize")
      }),
      getColumnNamesAsync: vi.fn(async () => []),
    }
    const valueFinalizeFailure = {
      executeForRawResultAsync: vi.fn(async () => ({
        getAllAsync: vi.fn(async () => [[1]]),
      })),
      finalizeAsync: vi.fn(async () => {
        throw new Error("value finalize")
      }),
    }
    database.prepareAsync
      .mockResolvedValueOnce(valueExecutionFailure as never)
      .mockRejectedValueOnce(new Error("raw prepare"))
      .mockResolvedValueOnce(rawFinalizeFailure as never)
      .mockResolvedValueOnce(valueFinalizeFailure as never)
    database.getEachAsync.mockImplementationOnce(() =>
      (async function* () {
        yield { id: 1 }
        throw new Error("iteration failed")
      })(),
    )
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)

    const exits = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqliteClient.SqliteClient
        return yield* Effect.all(
          [
            Effect.exit(sql`SELECT value`.values),
            Effect.exit(sql`UPDATE missing`.raw),
            Effect.exit(sql`UPDATE finalizer`.raw),
            Effect.exit(sql`SELECT finalizer`.values),
            Effect.exit(sql`SELECT stream`.stream.pipe(Stream.runDrain)),
          ],
          { concurrency: 1 },
        )
      }).pipe(provideLayer(SqliteClient.layer({ databaseName: "statement-failures.db" }))),
    )

    expect(exits).toHaveLength(5)
    for (const exit of exits) expect(exit._tag).toBe("Failure")
  })

  it("surfaces database close failures as scope-finalizer defects", async () => {
    const database = makeDatabase()
    database.closeAsync.mockRejectedValueOnce(new Error("close failed"))
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)

    const exit = await Effect.runPromiseExit(
      Effect.void.pipe(provideLayer(SqliteClient.layer({ databaseName: "close-failure.db" }))),
    )

    expect(exit._tag).toBe("Failure")
    expect(database.closeAsync).toHaveBeenCalledOnce()
  })

  it("builds clients from Effect Config and runs the shared SQLite migrator", async () => {
    const configDatabase = makeDatabase()
    const migratorDatabase = makeDatabase()
    migratorDatabase.getAllAsync.mockResolvedValue([])
    const migratorLayerDatabase = makeDatabase()
    migratorLayerDatabase.getAllAsync.mockResolvedValue([])
    mocks.openDatabaseAsync
      .mockResolvedValueOnce(configDatabase)
      .mockResolvedValueOnce(migratorDatabase)
      .mockResolvedValueOnce(migratorLayerDatabase)

    const configuredName = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqliteClient.SqliteClient
        return sql.config.databaseName
      }).pipe(
        provideLayer(
          SqliteClient.layerConfig(
            Config.succeed({
              databaseName: "configured.db",
              spanAttributes: { component: "test" },
            }),
          ),
        ),
      ),
    )

    const migrations = await Effect.runPromise(
      SqliteMigrator.run({ loader: Effect.succeed([]) }).pipe(
        provideLayer(SqliteClient.layer({ databaseName: "migrator.db" })),
      ),
    )
    await Effect.runPromise(
      Effect.void.pipe(
        provideLayer(
          SqliteMigrator.layer({ loader: Effect.succeed([]) }).pipe(
            Layer.provide(SqliteClient.layer({ databaseName: "migrator-layer.db" })),
          ),
        ),
      ),
    )

    expect(configuredName).toBe("configured.db")
    expect(migrations).toEqual([])
  })

  it("streams database changes and releases the Expo listener", async () => {
    const remove = vi.fn()
    mocks.addDatabaseChangeListener.mockImplementationOnce((listener) => {
      listener({
        databaseName: "main",
        databaseFilePath: "/sqlite/test.db",
        tableName: "users",
        rowId: 42,
      })
      return { remove }
    })

    const event = await Effect.runPromise(SQLite.addDatabaseChangeListener.pipe(Stream.runHead))

    expect(event).toMatchObject({
      _tag: "Some",
      value: {
        databaseName: "main",
        databaseFilePath: "/sqlite/test.db",
        tableName: "users",
        rowId: 42,
      },
    })
    expect(remove).toHaveBeenCalledOnce()
  })

  it("classifies synchronous change-listener installation failures", async () => {
    mocks.addDatabaseChangeListener.mockImplementationOnce(() => {
      throw new Error("listener unavailable")
    })

    const exit = await Effect.runPromiseExit(SQLite.addDatabaseChangeListener.pipe(Stream.runHead))

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      expect(exit.cause.reasons.find(Cause.isFailReason)?.error).toBeInstanceOf(SqlError)
    }
  })

  it("opens and closes a database with the Effect SQLite atom lifecycle", async () => {
    const database = makeDatabase()
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)
    const atom = SQLite.sqliteDatabaseAtom({
      databaseName: "atom.db",
      options: { enableChangeListener: true },
      directory: "/sqlite",
    })
    const registry = AtomRegistry.make()
    const release = registry.mount(atom)

    await vi.waitFor(() => expect(AsyncResult.getOrThrow(registry.get(atom))).toBe(database))
    expect(mocks.openDatabaseAsync).toHaveBeenCalledWith(
      "atom.db",
      { enableChangeListener: true },
      "/sqlite",
    )

    release()
    await vi.waitFor(() => expect(database.closeAsync).toHaveBeenCalledOnce())
  })

  it("opens and closes an Effect SQL client with the SQLite client atom lifecycle", async () => {
    const database = makeDatabase()
    mocks.openDatabaseAsync.mockResolvedValueOnce(database)
    const atom = SQLite.sqliteClientAtom({ databaseName: "atom-client.db" })
    const registry = AtomRegistry.make()
    const release = registry.mount(atom)

    await vi.waitFor(() => {
      const client = AsyncResult.getOrThrow(registry.get(atom))
      expect(client.config.databaseName).toBe("atom-client.db")
    })

    release()
    await vi.waitFor(() => expect(database.closeAsync).toHaveBeenCalledOnce())
  })
})
