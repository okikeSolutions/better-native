/**
 * Effect-native wrappers for Expo SQLite's database lifecycle operations.
 *
 * @since 0.0.0
 */
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import * as ExpoSQLite from "expo-sqlite"
import * as SqliteClient from "./SqliteClient.ts"

const failure = (operation: string, cause: unknown) =>
  new SqlError({
    reason: classifySqliteError(cause, {
      message: `Expo SQLite ${operation} failed`,
      operation,
    }),
  })

const tryPromise = <A>(operation: string, evaluate: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => failure(operation, cause),
  })

const trySync = <A>(operation: string, evaluate: () => A) =>
  Effect.try({
    try: evaluate,
    catch: (cause) => failure(operation, cause),
  })

/** Serialized SQLite changeset bytes. @since 0.0.0 */
export type Changeset = ExpoSQLite.Changeset
/** One database change notification. @since 0.0.0 */
export type DatabaseChangeEvent = ExpoSQLite.DatabaseChangeEvent
/** SQLite named or positional bind parameters. @since 0.0.0 */
export type SQLiteBindParams = ExpoSQLite.SQLiteBindParams
/** A value accepted by SQLite parameter binding. @since 0.0.0 */
export type SQLiteBindValue = ExpoSQLite.SQLiteBindValue
/** Result of asynchronously executing a prepared statement. @since 0.0.0 */
export type SQLiteExecuteAsyncResult<T> = ExpoSQLite.SQLiteExecuteAsyncResult<T>
/** Result of synchronously executing a prepared statement. @since 0.0.0 */
export type SQLiteExecuteSyncResult<T> = ExpoSQLite.SQLiteExecuteSyncResult<T>
/** Options used when opening an Expo SQLite database. @since 0.0.0 */
export type SQLiteOpenOptions = ExpoSQLite.SQLiteOpenOptions
/** A bundled database asset accepted by Expo SQLite. @since 0.0.0 */
export type SQLiteProviderAssetSource = ExpoSQLite.SQLiteProviderAssetSource
/** Props accepted by Expo's SQLiteProvider component. @since 0.0.0 */
export type SQLiteProviderProps = ExpoSQLite.SQLiteProviderProps
/** Metadata returned after a SQLite mutation. @since 0.0.0 */
export type SQLiteRunResult = ExpoSQLite.SQLiteRunResult
/** Positional SQLite bind parameters. @since 0.0.0 */
export type SQLiteVariadicBindParams = ExpoSQLite.SQLiteVariadicBindParams

/**
 * Configuration for an Effect Atom that owns an Expo SQLite database connection.
 *
 * This replaces the Expo `SQLiteProvider` and `useSQLiteContext` pair for Effect applications.
 *
 * @category atoms
 * @since 0.0.0
 */
export interface SQLiteDatabaseAtomOptions {
  readonly databaseName: string
  readonly options?: SQLiteOpenOptions | undefined
  readonly directory?: string | undefined
}

/**
 * Options accepted by Expo SQLite's database backup operations.
 *
 * @category models
 * @since 0.0.0
 */
export interface BackupOptions {
  readonly sourceDatabase: ExpoSQLite.SQLiteDatabase
  readonly sourceDatabaseName?: string
  readonly destDatabase: ExpoSQLite.SQLiteDatabase
  readonly destDatabaseName?: string
}

/**
 * Streams database change events and removes the native subscription when the stream closes.
 * The database must be opened with `enableChangeListener: true`.
 *
 * @category streams
 * @since 0.0.0
 */
export const addDatabaseChangeListener = Stream.callback<DatabaseChangeEvent, SqlError>((queue) =>
  Effect.acquireRelease(
    trySync("addDatabaseChangeListener", () =>
      ExpoSQLite.addDatabaseChangeListener((event) => Queue.offerUnsafe(queue, event)),
    ).pipe(Effect.tapError((error) => Queue.fail(queue, error))),
    (subscription) => Effect.sync(() => subscription.remove()),
  ),
)

/**
 * Backs one open Expo database up to another.
 *
 * @category operations
 * @since 0.0.0
 */
export const backupDatabaseAsync = (options: BackupOptions): Effect.Effect<void, SqlError> =>
  tryPromise("backupDatabaseAsync", () => ExpoSQLite.backupDatabaseAsync(options))

/**
 * Runs Expo's synchronous backup lazily inside an Effect.
 *
 * @category operations
 * @since 0.0.0
 */
export const backupDatabaseSync = (options: BackupOptions): Effect.Effect<void, SqlError> =>
  trySync("backupDatabaseSync", () => ExpoSQLite.backupDatabaseSync(options))

/**
 * Deletes a database asynchronously.
 *
 * @category operations
 * @since 0.0.0
 */
export const deleteDatabaseAsync = (
  databaseName: string,
  directory?: string,
): Effect.Effect<void, SqlError> =>
  tryPromise("deleteDatabaseAsync", () => ExpoSQLite.deleteDatabaseAsync(databaseName, directory))

/**
 * Runs Expo's synchronous database deletion lazily inside an Effect.
 *
 * @category operations
 * @since 0.0.0
 */
export const deleteDatabaseSync = (
  databaseName: string,
  directory?: string,
): Effect.Effect<void, SqlError> =>
  trySync("deleteDatabaseSync", () => ExpoSQLite.deleteDatabaseSync(databaseName, directory))

/** Opens a database from serialized bytes and closes it when the Effect scope closes. @since 0.0.0 */
export const deserializeDatabaseAsync = (
  serializedData: Uint8Array,
  options?: SQLiteOpenOptions,
): Effect.Effect<ExpoSQLite.SQLiteDatabase, SqlError, Scope.Scope> =>
  Effect.acquireRelease(
    tryPromise("deserializeDatabaseAsync", () =>
      ExpoSQLite.deserializeDatabaseAsync(serializedData, options),
    ),
    (database) => tryPromise("closeAsync", () => database.closeAsync()).pipe(Effect.orDie),
  )

/** Opens serialized bytes synchronously and closes the database with its Effect scope. @since 0.0.0 */
export const deserializeDatabaseSync = (
  serializedData: Uint8Array,
  options?: SQLiteOpenOptions,
): Effect.Effect<ExpoSQLite.SQLiteDatabase, SqlError, Scope.Scope> =>
  Effect.acquireRelease(
    trySync("deserializeDatabaseSync", () =>
      ExpoSQLite.deserializeDatabaseSync(serializedData, options),
    ),
    (database) => trySync("closeSync", () => database.closeSync()).pipe(Effect.orDie),
  )

/** Imports a bundled database asset into Expo SQLite's database directory. @since 0.0.0 */
export const importDatabaseFromAssetAsync = (
  databaseName: string,
  assetSource: SQLiteProviderAssetSource,
  directory?: string,
): Effect.Effect<void, SqlError> =>
  tryPromise("importDatabaseFromAssetAsync", () =>
    ExpoSQLite.importDatabaseFromAssetAsync(databaseName, assetSource, directory),
  )

/** Opens an Expo database and closes it when the Effect scope closes. @since 0.0.0 */
export const openDatabaseAsync = (
  databaseName: string,
  options?: SQLiteOpenOptions,
  directory?: string,
): Effect.Effect<ExpoSQLite.SQLiteDatabase, SqlError, Scope.Scope> =>
  Effect.acquireRelease(
    tryPromise("openDatabaseAsync", () =>
      ExpoSQLite.openDatabaseAsync(databaseName, options, directory),
    ),
    (database) => tryPromise("closeAsync", () => database.closeAsync()).pipe(Effect.orDie),
  )

/** Opens an Expo database synchronously and closes it when the Effect scope closes. @since 0.0.0 */
export const openDatabaseSync = (
  databaseName: string,
  options?: SQLiteOpenOptions,
  directory?: string,
): Effect.Effect<ExpoSQLite.SQLiteDatabase, SqlError, Scope.Scope> =>
  Effect.acquireRelease(
    trySync("openDatabaseSync", () =>
      ExpoSQLite.openDatabaseSync(databaseName, options, directory),
    ),
    (database) => trySync("closeSync", () => database.closeSync()).pipe(Effect.orDie),
  )

const sqliteDatabaseAtoms = Atom.family((config: SQLiteDatabaseAtomOptions) =>
  Atom.make(openDatabaseAsync(config.databaseName, config.options, config.directory)),
)

/**
 * Creates an Effect Atom for a scoped Expo SQLite database connection.
 *
 * Mount the returned atom with `@effect/atom-react` or an `AtomRegistry`. The connection opens on
 * mount and closes when the final consumer unmounts. This is the Effect-native replacement for
 * Expo's `SQLiteProvider` and `useSQLiteContext` hook.
 *
 * @category atoms
 * @since 0.0.0
 */
export const sqliteDatabaseAtom = (config: SQLiteDatabaseAtomOptions) => sqliteDatabaseAtoms(config)

const sqliteClientAtoms = Atom.family((config: SQLiteDatabaseAtomOptions) =>
  Atom.make(
    SqliteClient.make({
      databaseName: config.databaseName,
      openOptions: config.options,
      directory: config.directory,
      // This atom is the React application boundary that owns the client scope.
      // oxlint-disable-next-line effecttsgo/strict-effect-provide
    }).pipe(Effect.provide(Reactivity.layer)),
  ),
)

/**
 * Creates an Effect Atom for the Expo-backed Effect SQL client.
 *
 * Mount the returned atom with `@effect/atom-react` or an `AtomRegistry`. It provides the same
 * scoped connection lifecycle as {@link SqliteClient.make}, including serialization, transactions,
 * reactivity, typed SQL failures, and tracing. This is the preferred replacement for Expo's
 * `SQLiteProvider` and `useSQLiteContext` pair in Effect applications.
 *
 * @category atoms
 * @since 0.0.0
 */
export const sqliteClientAtom = (config: SQLiteDatabaseAtomOptions) => sqliteClientAtoms(config)
