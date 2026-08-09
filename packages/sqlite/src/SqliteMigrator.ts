/**
 * Metro-safe Effect SQL migrations for Expo SQLite.
 *
 * @since 0.0.0
 */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Client from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

/**
 * Options for loading and recording ordered migrations.
 * @since 0.0.0
 */
export interface MigratorOptions<R = never> {
  readonly loader: Loader<R>
  readonly schemaDirectory?: string
  readonly table?: string
}

/**
 * Effect that resolves the available migrations.
 * @since 0.0.0
 */
export type Loader<R = never> = Effect.Effect<ReadonlyArray<ResolvedMigration>, MigrationError, R>

/**
 * One numbered migration and the Effect that loads its implementation.
 * @since 0.0.0
 */
export type ResolvedMigration = readonly [
  id: number,
  name: string,
  load: Effect.Effect<unknown, never, Client.SqlClient>,
]

/**
 * Metadata for a migration already recorded in the schema table.
 * @since 0.0.0
 */
export interface Migration {
  readonly id: number
  readonly name: string
  readonly createdAt: Date
}

/**
 * Failure raised while loading, validating, locking, or running migrations.
 * @since 0.0.0
 */
export class MigrationError extends Data.TaggedError("MigrationError")<{
  readonly _tag: "MigrationError"
  readonly cause?: unknown
  readonly kind: "BadState" | "ImportError" | "Failed" | "Duplicates" | "Locked"
  readonly message: string
}> {}

const isConstraintConflict = (error: SqlError): boolean =>
  error.reason._tag === "ConstraintError" || error.reason._tag === "UniqueViolation"

/**
 * Creates a Metro-safe migrator using Effect's `SqlClient` contract.
 *
 * This mirrors Effect's shared migrator without importing its Node-oriented dynamic filesystem
 * loader, whose template import cannot be transformed by Metro.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make =
  <RD = never>({
    dumpSchema = () => Effect.void,
  }: {
    readonly dumpSchema?: (
      path: string,
      migrationsTable: string,
    ) => Effect.Effect<void, MigrationError, RD>
  }) =>
  <R2 = never>({
    loader,
    schemaDirectory,
    table = "effect_sql_migrations",
  }: MigratorOptions<R2>): Effect.Effect<
    ReadonlyArray<readonly [id: number, name: string]>,
    MigrationError | SqlError,
    Client.SqlClient | RD | R2
  > =>
    Effect.gen(function* () {
      const sql = yield* Client.SqlClient
      const ensureMigrationsTable = sql.onDialectOrElse({
        mssql: () =>
          sql`IF OBJECT_ID(N'${sql.literal(table)}', N'U') IS NULL
  CREATE TABLE ${sql(table)} (
    migration_id INT NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT GETDATE()
  )`,
        mysql: () =>
          sql`CREATE TABLE IF NOT EXISTS ${sql(table)} (
  migration_id INTEGER UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  name VARCHAR(255) NOT NULL,
  PRIMARY KEY (migration_id)
)`,
        pg: () =>
          Effect.catch(
            sql`select ${table}::regclass`,
            () =>
              sql`CREATE TABLE ${sql(table)} (
  migration_id integer primary key,
  created_at timestamp with time zone not null default now(),
  name text not null
)`,
          ),
        orElse: () =>
          sql`CREATE TABLE IF NOT EXISTS ${sql(table)} (
  migration_id integer PRIMARY KEY NOT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp,
  name VARCHAR(255) NOT NULL
)`,
      })

      const latestMigration = Effect.map(
        sql<{
          migration_id: number
          name: string
          created_at: Date
        }>`SELECT migration_id, name, created_at FROM ${sql(table)} ORDER BY migration_id DESC`
          .withoutTransform,
        (rows) =>
          Option.map(
            Option.fromNullishOr(rows[0]),
            ({ created_at, migration_id, name }): Migration => ({
              id: migration_id,
              name,
              createdAt: created_at,
            }),
          ),
      )

      const loadMigration = ([id, name, load]: ResolvedMigration): Effect.Effect<
        Effect.Effect<unknown, unknown, Client.SqlClient>,
        MigrationError,
        Client.SqlClient
      > =>
        Effect.catchDefect(load, (cause) =>
          Effect.fail(
            new MigrationError({
              kind: "ImportError",
              message: `Could not import migration "${id}_${name}"\n\n${cause}`,
            }),
          ),
        ).pipe(
          Effect.flatMap((loaded) => {
            // Dynamic migration modules must be narrowed from unknown before their Effect can run.
            // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
            if (Effect.isEffect(loaded)) return Effect.succeed(loaded)
            if (typeof loaded === "object" && loaded !== null && "default" in loaded) {
              const defaultExport = loaded.default
              return Effect.succeed(
                typeof defaultExport === "object" &&
                  defaultExport !== null &&
                  "default" in defaultExport
                  ? defaultExport.default
                  : defaultExport,
              )
            }
            return Effect.fail(
              new MigrationError({
                kind: "ImportError",
                message: `Default export not found for migration "${id}_${name}"`,
              }),
            )
          }),
          Effect.filterOrFail(
            Effect.isEffect,
            () =>
              new MigrationError({
                kind: "ImportError",
                message: `Default export was not an Effect for migration "${id}_${name}"`,
              }),
          ),
          // Migration error types are intentionally open and become a `MigrationError` defect below.
          // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
          Effect.map((migration) => migration as Effect.Effect<unknown, unknown, Client.SqlClient>),
        )

      const execute: Effect.Effect<
        ReadonlyArray<readonly [number, string]>,
        MigrationError | SqlError,
        Client.SqlClient | R2
      > = Effect.gen(function* () {
        yield* sql.onDialectOrElse({
          pg: () => sql`LOCK TABLE ${sql(table)} IN ACCESS EXCLUSIVE MODE`,
          orElse: () => Effect.void,
        })
        const [latestId, current] = yield* Effect.all([
          Effect.map(
            latestMigration,
            Option.match({ onNone: () => 0, onSome: (migration) => migration.id }),
          ),
          loader,
        ])
        if (new Set(current.map(([id]) => id)).size !== current.length) {
          return yield* new MigrationError({
            kind: "Duplicates",
            message: "Found duplicate migration id's",
          })
        }
        const required: Array<
          readonly [number, string, Effect.Effect<unknown, unknown, Client.SqlClient>]
        > = []
        for (const resolved of current) {
          if (resolved[0] <= latestId) continue
          required.push([resolved[0], resolved[1], yield* loadMigration(resolved)])
        }
        if (required.length > 0) {
          yield* sql`INSERT INTO ${sql(table)} ${sql.insert(
            required.map(([migration_id, name]) => ({ migration_id, name })),
          )}`.withoutTransform.pipe(
            Effect.mapError((error): MigrationError | SqlError =>
              isConstraintConflict(error)
                ? new MigrationError({ kind: "Locked", message: "Migrations already running" })
                : error,
            ),
          )
        }
        yield* Effect.forEach(
          required,
          ([id, name, migration]) =>
            Effect.catch(migration, (cause) =>
              Effect.die(
                new MigrationError({
                  cause,
                  kind: "Failed",
                  message: `Migration "${id}_${name}" failed`,
                }),
              ),
            ).pipe(
              Effect.annotateLogs("migration_id", String(id)),
              Effect.annotateLogs("migration_name", name),
              Effect.withSpan(`Migrator ${id}_${name}`),
            ),
          { discard: true },
        )
        return required.map(([id, name]) => [id, name] as const)
      })

      yield* ensureMigrationsTable
      const completed = yield* sql
        .withTransaction(execute)
        .pipe(
          Effect.catchTag("MigrationError", (error) =>
            error.kind === "Locked" ? Effect.succeed([]) : Effect.fail(error),
          ),
        )
      if (schemaDirectory !== undefined && completed.length > 0) {
        yield* dumpSchema(`${schemaDirectory}/_schema.sql`, table).pipe(
          Effect.catchCause((cause) => Effect.logInfo("Could not dump schema", cause)),
        )
      }
      return completed
    })

/**
 * Creates a sorted loader from a glob record of dynamic import functions.
 * @since 0.0.0
 */
export const fromGlob = (migrations: Record<string, () => Promise<unknown>>): Loader =>
  Effect.succeed(
    Object.entries(migrations)
      .flatMap(([key, load]): ReadonlyArray<ResolvedMigration> => {
        const match = key.match(/^(?:.*\/)?(\d+)_([^.]+)\.(js|ts|mjs|mts)$/)
        return match === null
          ? []
          : [[Number(match[1]), match[2] as string, Effect.promise(load)] as const]
      })
      .sort(([left], [right]) => left - right),
  )

/**
 * Creates a sorted loader from Babel-transformed migration modules.
 * @since 0.0.0
 */
export const fromBabelGlob = (migrations: Record<string, unknown>): Loader =>
  Effect.succeed(
    Object.entries(migrations)
      .flatMap(([key, migration]): ReadonlyArray<ResolvedMigration> => {
        const match = key.match(/^_(\d+)_([^.]+?)(Js|Ts|Mjs|Mts)?$/)
        return match === null
          ? []
          : [[Number(match[1]), match[2] as string, Effect.succeed(migration)] as const]
      })
      .sort(([left], [right]) => left - right),
  )

/**
 * Creates a sorted loader from migration Effects keyed by `<id>_<name>`.
 * @since 0.0.0
 */
export const fromRecord = <E>(
  migrations: Record<string, Effect.Effect<void, E, Client.SqlClient>>,
): Loader =>
  Effect.succeed(
    Object.entries(migrations)
      .flatMap(([key, migration]): ReadonlyArray<ResolvedMigration> => {
        const match = key.match(/^(\d+)_(.+)$/)
        return match === null
          ? []
          : [[Number(match[1]), match[2] as string, Effect.succeed(migration)] as const]
      })
      .sort(([left], [right]) => left - right),
  )

/**
 * Runs ordered Effect SQL migrations through the current Expo SQLite client.
 * @since 0.0.0
 */
export const run = make({})

/**
 * Runs Expo SQLite migrations while constructing a Layer.
 * @since 0.0.0
 */
export const layer = <R>(
  options: MigratorOptions<R>,
): Layer.Layer<never, SqlError | MigrationError, R | Client.SqlClient> =>
  Layer.effectDiscard(run(options))
