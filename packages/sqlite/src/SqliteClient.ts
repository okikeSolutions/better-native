/**
 * Connects Effect SQL to Expo SQLite.
 *
 * @since 0.0.0
 */
import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { identity } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as Client from "effect/unstable/sql/SqlClient"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import * as Statement from "effect/unstable/sql/Statement"
import * as ExpoSQLite from "expo-sqlite"

const ATTR_DB_SYSTEM_NAME = "db.system.name"

const sqlError = (cause: unknown, message: string, operation: string) =>
  new SqlError({ reason: classifySqliteError(cause, { message, operation }) })

/**
 * Runtime identifier attached to Expo SQLite client values.
 *
 * @category type IDs
 * @since 0.0.0
 */
export const TypeId: TypeId = "~@better-native/sqlite/SqliteClient"

/**
 * Type-level identifier for Expo SQLite client values.
 *
 * @category type IDs
 * @since 0.0.0
 */
export type TypeId = "~@better-native/sqlite/SqliteClient"

/**
 * Expo SQLite client service, extending Effect's generic `SqlClient`.
 *
 * @category models
 * @since 0.0.0
 */
export interface SqliteClient extends Client.SqlClient {
  readonly [TypeId]: TypeId
  readonly config: SqliteClientConfig
  readonly export: Effect.Effect<Uint8Array, SqlError>
  readonly loadExtension: (path: string, entryPoint?: string) => Effect.Effect<void, SqlError>
  readonly syncLibSQL: Effect.Effect<void, SqlError>

  /** Not supported in SQLite. */
  readonly updateValues: never
}

/**
 * Service tag for the Expo SQLite client.
 *
 * @category services
 * @since 0.0.0
 */
export const SqliteClient = Context.Service<SqliteClient>("@better-native/sqlite/SqliteClient")

/**
 * Configuration for an Expo SQLite-backed Effect SQL client.
 *
 * Set `openOptions.enableChangeListener` to install Expo's update hook and invalidate Effect
 * reactivity keys using the changed table name and row ID.
 *
 * @category models
 * @since 0.0.0
 */
export interface SqliteClientConfig {
  readonly databaseName: string
  readonly directory?: string | undefined
  readonly openOptions?: ExpoSQLite.SQLiteOpenOptions | undefined
  readonly spanAttributes?: Record<string, unknown> | undefined
  readonly transformResultNames?: ((name: string) => string) | undefined
  readonly transformQueryNames?: ((name: string) => string) | undefined
}

interface SqliteConnection extends Connection {
  readonly export: Effect.Effect<Uint8Array, SqlError>
  readonly loadExtension: (path: string, entryPoint?: string) => Effect.Effect<void, SqlError>
  readonly syncLibSQL: Effect.Effect<void, SqlError>
}

const bindParams = (params: ReadonlyArray<unknown>): ExpoSQLite.SQLiteBindValue[] =>
  params as ExpoSQLite.SQLiteBindValue[]

/**
 * Creates a scoped Effect SQL client backed by `expo-sqlite`.
 *
 * The client owns one serialized Expo connection. It supports Effect SQL tagged templates,
 * nested transactions, row/value queries, streaming, schemas, resolvers, migrations, tracing,
 * and reactivity.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = (
  options: SqliteClientConfig,
): Effect.Effect<SqliteClient, SqlError, Scope.Scope | Reactivity.Reactivity> =>
  Effect.gen(function* () {
    const reactivity = yield* Reactivity.Reactivity
    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames)
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined

    const database = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          ExpoSQLite.openDatabaseAsync(
            options.databaseName,
            options.openOptions,
            options.directory,
          ),
        catch: (cause) => sqlError(cause, "Failed to open database", "openDatabaseAsync"),
      }),
      (openedDatabase) =>
        Effect.tryPromise({
          try: () => openedDatabase.closeAsync(),
          catch: (cause) => sqlError(cause, "Failed to close database", "closeAsync"),
        }).pipe(Effect.orDie),
    )

    if (options.openOptions?.enableChangeListener === true) {
      yield* Effect.acquireRelease(
        Effect.try({
          try: () =>
            ExpoSQLite.addDatabaseChangeListener((event) => {
              if (event.databaseFilePath !== database.databasePath) return
              reactivity.invalidateUnsafe({ [event.tableName]: [String(event.rowId)] })
            }),
          catch: (cause) =>
            sqlError(cause, "Failed to add database change listener", "addDatabaseChangeListener"),
        }),
        (subscription) => Effect.sync(() => subscription.remove()),
      )
    }

    const run = (sql: string, params: ReadonlyArray<unknown> = []) =>
      Effect.tryPromise({
        try: () => database.getAllAsync<any>(sql, bindParams(params)),
        catch: (cause) => sqlError(cause, "Failed to execute statement", "execute"),
      })

    const runValues = (sql: string, params: ReadonlyArray<unknown> = []) =>
      Effect.scoped(
        Effect.acquireRelease(
          Effect.tryPromise({
            try: () => database.prepareAsync(sql),
            catch: (cause) => sqlError(cause, "Failed to prepare statement", "prepareAsync"),
          }),
          (statement) =>
            Effect.tryPromise({
              try: () => statement.finalizeAsync(),
              catch: (cause) => sqlError(cause, "Failed to finalize statement", "finalizeAsync"),
            }).pipe(Effect.orDie),
        ).pipe(
          Effect.flatMap((statement) =>
            Effect.tryPromise({
              try: async () => {
                const result = await statement.executeForRawResultAsync(bindParams(params))
                return await result.getAllAsync()
              },
              catch: (cause) =>
                sqlError(cause, "Failed to execute value statement", "executeValues"),
            }),
          ),
        ),
      )

    const runRaw = (sql: string, params: ReadonlyArray<unknown> = []) =>
      Effect.scoped(
        Effect.acquireRelease(
          Effect.tryPromise({
            try: () => database.prepareAsync(sql),
            catch: (cause) => sqlError(cause, "Failed to prepare raw statement", "prepareAsync"),
          }),
          (statement) =>
            Effect.tryPromise({
              try: () => statement.finalizeAsync(),
              catch: (cause) => sqlError(cause, "Failed to finalize statement", "finalizeAsync"),
            }).pipe(Effect.orDie),
        ).pipe(
          Effect.flatMap((statement) =>
            Effect.tryPromise({
              try: async () => {
                const columns = await statement.getColumnNamesAsync()
                const result = await statement.executeAsync<any>(bindParams(params))
                return columns.length > 0
                  ? await result.getAllAsync()
                  : { changes: result.changes, lastInsertRowid: result.lastInsertRowId }
              },
              catch: (cause) => sqlError(cause, "Failed to execute raw statement", "executeRaw"),
            }),
          ),
        ),
      )

    const connection = identity<SqliteConnection>({
      execute(sql, params, rowTransform) {
        return rowTransform ? Effect.map(run(sql, params), rowTransform) : run(sql, params)
      },
      executeRaw(sql, params) {
        return runRaw(sql, params)
      },
      executeValues(sql, params) {
        return runValues(sql, params)
      },
      executeValuesUnprepared(sql, params) {
        return runValues(sql, params)
      },
      executeUnprepared(sql, params, rowTransform) {
        return this.execute(sql, params, rowTransform)
      },
      executeStream(sql, params, rowTransform) {
        const rows = Stream.unwrap(
          Effect.try({
            try: () => database.getEachAsync<any>(sql, bindParams(params)),
            catch: (cause) => sqlError(cause, "Failed to start statement stream", "executeStream"),
          }).pipe(
            Effect.map((iterator) =>
              Stream.fromAsyncIterable(iterator, (cause) =>
                sqlError(cause, "Failed to stream statement", "executeStream"),
              ),
            ),
          ),
        )
        return rowTransform
          ? rows.pipe(Stream.mapArray((chunk) => rowTransform(chunk) as any))
          : rows
      },
      export: Effect.tryPromise({
        try: () => database.serializeAsync(),
        catch: (cause) => sqlError(cause, "Failed to export database", "serializeAsync"),
      }),
      loadExtension: (path, entryPoint) =>
        Effect.tryPromise({
          try: () => database.loadExtensionAsync(path, entryPoint),
          catch: (cause) => sqlError(cause, "Failed to load extension", "loadExtensionAsync"),
        }),
      syncLibSQL: Effect.tryPromise({
        try: () => database.syncLibSQL(),
        catch: (cause) => sqlError(cause, "Failed to synchronize libSQL", "syncLibSQL"),
      }),
    })

    const semaphore = yield* Semaphore.make(1)
    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection))
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!
      const scope = Context.getUnsafe(fiber.context, Scope.Scope)
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () =>
          Scope.addFinalizer(scope, semaphore.release(1)),
        ),
        connection,
      )
    })

    return Object.assign(
      (yield* Client.make({
        acquirer,
        compiler,
        transactionAcquirer,
        spanAttributes: [
          ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
          [ATTR_DB_SYSTEM_NAME, "sqlite"],
        ],
        transformRows,
      })) as SqliteClient,
      {
        [TypeId]: TypeId as TypeId,
        config: options,
        export: Effect.flatMap(acquirer, (acquired) => acquired.export),
        loadExtension: (path: string, entryPoint?: string) =>
          Effect.flatMap(acquirer, (acquired) => acquired.loadExtension(path, entryPoint)),
        syncLibSQL: Effect.flatMap(acquirer, (acquired) => acquired.syncLibSQL),
      },
    )
  })

/**
 * Builds a layer from an Effect `Config` value, providing both the Expo-specific client and the
 * generic Effect `SqlClient` service.
 *
 * @category layers
 * @since 0.0.0
 */
export const layerConfig = (
  config: Config.Wrap<SqliteClientConfig>,
): Layer.Layer<SqliteClient | Client.SqlClient, Config.ConfigError | SqlError> =>
  Layer.effectContext(
    Config.unwrap(config).pipe(
      Effect.flatMap(make),
      Effect.map((client) =>
        Context.make(SqliteClient, client).pipe(Context.add(Client.SqlClient, client)),
      ),
    ),
  ).pipe(Layer.provide(Reactivity.layer))

/**
 * Builds a layer from concrete Expo SQLite configuration, providing both the Expo-specific client
 * and the generic Effect `SqlClient` service.
 *
 * @example
 * ```ts
 * import { SqliteClient } from "@better-native/sqlite"
 * import * as Effect from "effect/Effect"
 * import * as SqlClient from "effect/unstable/sql/SqlClient"
 *
 * const program = Effect.gen(function* () {
 *   const sql = yield* SqlClient.SqlClient
 *   yield* sql`CREATE TABLE IF NOT EXISTS notes (body TEXT NOT NULL)`
 *   return yield* sql<{ readonly body: string }>`SELECT body FROM notes`
 * }).pipe(Effect.provide(SqliteClient.layer({ databaseName: "app.db" })))
 * ```
 *
 * @category layers
 * @since 0.0.0
 */
export const layer = (
  config: SqliteClientConfig,
): Layer.Layer<SqliteClient | Client.SqlClient, SqlError> =>
  Layer.effectContext(
    Effect.map(make(config), (client) =>
      Context.make(SqliteClient, client).pipe(Context.add(Client.SqlClient, client)),
    ),
  ).pipe(Layer.provide(Reactivity.layer))
