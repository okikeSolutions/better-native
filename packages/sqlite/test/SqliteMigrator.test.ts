import { describe, expect, it, vi } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import * as SqliteMigrator from "../src/SqliteMigrator"

type Dialect = "mssql" | "mysql" | "pg" | "sqlite"

const makeSql = (options?: {
  readonly dialect?: Dialect
  readonly latest?: ReadonlyArray<{
    readonly migration_id: number
    readonly name: string
    readonly created_at: Date
  }>
  readonly failPgProbe?: boolean
  readonly insertError?: unknown
}) => {
  const statements: Array<string> = []
  const dialect = options?.dialect ?? "sqlite"

  const sql = ((first: TemplateStringsArray | string, ...params: ReadonlyArray<unknown>) => {
    if (typeof first === "string") return first
    const text = first.reduce(
      (acc, part, index) => `${acc}${part}${index < params.length ? String(params[index]) : ""}`,
      "",
    )
    const statement = Effect.suspend(() => {
      statements.push(text)
      if (options?.failPgProbe === true && text.startsWith("select ")) {
        return Effect.fail("missing migrations table")
      }
      if (text.startsWith("INSERT INTO") && options?.insertError !== undefined) {
        return Effect.fail(options.insertError)
      }
      if (text.startsWith("SELECT migration_id")) {
        return Effect.succeed(options?.latest ?? [])
      }
      return Effect.succeed([])
    })
    return Object.assign(statement, { withoutTransform: statement })
  }) as unknown as SqlClient.SqlClient

  Object.assign(sql, {
    insert: (rows: ReadonlyArray<unknown>) => JSON.stringify(rows),
    literal: (value: string) => value,
    onDialectOrElse: (cases: Record<string, () => Effect.Effect<unknown, unknown>>) =>
      (cases[dialect] ?? cases.orElse)?.(),
    withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
  })

  return { sql, statements }
}

const runWith = <A, E, R>(effect: Effect.Effect<A, E, R>, sql: SqlClient.SqlClient) =>
  Effect.runPromise(
    effect.pipe(Effect.provideService(SqlClient.SqlClient, sql)) as Effect.Effect<A, E>,
  )

const runExitWith = <A, E, R>(effect: Effect.Effect<A, E, R>, sql: SqlClient.SqlClient) =>
  Effect.runPromiseExit(
    effect.pipe(Effect.provideService(SqlClient.SqlClient, sql)) as Effect.Effect<A, E>,
  )

describe("@better-native/sqlite migrator", () => {
  it("parses and sorts glob, Babel-glob, and record loaders", async () => {
    const noop = Effect.void
    const glob = await Effect.runPromise(
      SqliteMigrator.fromGlob({
        "./10_tenth.mts": async () => ({ default: noop }),
        "./2_second.ts": async () => ({ default: noop }),
        "./3_third.js": async () => ({ default: noop }),
        "./4_fourth.mjs": async () => ({ default: noop }),
        "./README.md": async () => ({ default: noop }),
      }),
    )
    const babel = await Effect.runPromise(
      SqliteMigrator.fromBabelGlob({
        _10_tenthMts: { default: noop },
        _2_secondTs: { default: noop },
        _3_thirdJs: { default: noop },
        _4_fourthMjs: { default: noop },
        _5_plain: { default: noop },
        ignored: { default: noop },
      }),
    )
    const record = await Effect.runPromise(
      SqliteMigrator.fromRecord({
        "10_tenth": noop,
        "2_second": noop,
        ignored: noop,
      }),
    )

    expect(glob.map(([id, name]) => [id, name])).toEqual([
      [2, "second"],
      [3, "third"],
      [4, "fourth"],
      [10, "tenth"],
    ])
    expect(babel.map(([id, name]) => [id, name])).toEqual([
      [2, "second"],
      [3, "third"],
      [4, "fourth"],
      [5, "plain"],
      [10, "tenth"],
    ])
    expect(record.map(([id, name]) => [id, name])).toEqual([
      [2, "second"],
      [10, "tenth"],
    ])
  })

  it.each(["mssql", "mysql", "sqlite"] as const)(
    "uses the %s migrations-table dialect",
    async (dialect) => {
      const { sql, statements } = makeSql({ dialect })
      await expect(
        runWith(SqliteMigrator.run({ loader: Effect.succeed([]) }), sql),
      ).resolves.toEqual([])
      expect(statements[0]).toContain(dialect === "mssql" ? "OBJECT_ID" : "CREATE TABLE")
    },
  )

  it("uses PostgreSQL probing, fallback creation, and transaction locking", async () => {
    const available = makeSql({ dialect: "pg" })
    await runWith(SqliteMigrator.run({ loader: Effect.succeed([]) }), available.sql)
    expect(available.statements.some((sql) => sql.startsWith("select "))).toBe(true)
    expect(available.statements.some((sql) => sql.startsWith("LOCK TABLE"))).toBe(true)

    const missing = makeSql({ dialect: "pg", failPgProbe: true })
    await runWith(SqliteMigrator.run({ loader: Effect.succeed([]) }), missing.sql)
    expect(missing.statements.some((sql) => sql.includes("CREATE TABLE"))).toBe(true)
  })

  it("runs only pending migrations and supports direct, default, and nested-default modules", async () => {
    const executed: Array<string> = []
    const dumpSchema = vi.fn(() =>
      Effect.fail(
        new SqliteMigrator.MigrationError({
          kind: "BadState",
          message: "dump unavailable",
        }),
      ),
    )
    const { sql, statements } = makeSql({
      latest: [{ migration_id: 1, name: "existing", created_at: new Date(0) }],
    })
    const migrate = SqliteMigrator.make({ dumpSchema })({
      table: "custom_migrations",
      schemaDirectory: "/schema",
      loader: Effect.succeed([
        [1, "existing", Effect.succeed(Effect.sync(() => executed.push("existing")))],
        [2, "direct", Effect.succeed(Effect.sync(() => executed.push("direct")))],
        [3, "default", Effect.succeed({ default: Effect.sync(() => executed.push("default")) })],
        [
          4,
          "nested",
          Effect.succeed({ default: { default: Effect.sync(() => executed.push("nested")) } }),
        ],
      ] as ReadonlyArray<SqliteMigrator.ResolvedMigration>),
    })

    await expect(runWith(migrate, sql)).resolves.toEqual([
      [2, "direct"],
      [3, "default"],
      [4, "nested"],
    ])
    expect(executed).toEqual(["direct", "default", "nested"])
    expect(
      statements.some((statement) => statement.startsWith("INSERT INTO custom_migrations")),
    ).toBe(true)
    expect(dumpSchema).toHaveBeenCalledWith("/schema/_schema.sql", "custom_migrations")
  })

  it("rejects duplicate IDs and each invalid migration module shape", async () => {
    const duplicateSql = makeSql().sql
    const duplicate = await runExitWith(
      SqliteMigrator.run({
        loader: Effect.succeed([
          [1, "one", Effect.succeed(Effect.void)],
          [1, "again", Effect.succeed(Effect.void)],
        ]),
      }),
      duplicateSql,
    )
    expect(Exit.isFailure(duplicate)).toBe(true)
    if (Exit.isFailure(duplicate)) {
      expect(duplicate.cause.reasons.find(Cause.isFailReason)?.error).toMatchObject({
        kind: "Duplicates",
      })
    }

    const invalidLoads: ReadonlyArray<SqliteMigrator.ResolvedMigration> = [
      [1, "defect", Effect.die("import defect")],
      [1, "missing", Effect.succeed({})],
      [1, "invalid", Effect.succeed({ default: "not an Effect" })],
      [1, "nested-invalid", Effect.succeed({ default: { default: null } })],
    ]
    for (const migration of invalidLoads) {
      const exit = await runExitWith(
        SqliteMigrator.run({ loader: Effect.succeed([migration]) }),
        makeSql().sql,
      )
      expect(Exit.isFailure(exit), migration[1]).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons.find(Cause.isFailReason)?.error).toMatchObject({
          kind: "ImportError",
        })
      }
    }
  })

  it("turns migration failures into defects and treats insertion conflicts as concurrent locks", async () => {
    const failed = await runExitWith(
      SqliteMigrator.run({
        loader: SqliteMigrator.fromRecord({ "1_failure": Effect.fail("migration failed") }),
      }),
      makeSql().sql,
    )
    expect(Exit.isFailure(failed)).toBe(true)
    if (Exit.isFailure(failed)) {
      expect(failed.cause.reasons.find(Cause.isDieReason)?.defect).toMatchObject({ kind: "Failed" })
    }

    for (const tag of ["ConstraintError", "UniqueViolation"] as const) {
      const locked = makeSql({ insertError: { reason: { _tag: tag } } })
      await expect(
        runWith(
          SqliteMigrator.run({
            loader: SqliteMigrator.fromRecord({ "1_locked": Effect.void }),
          }),
          locked.sql,
        ),
      ).resolves.toEqual([])
    }

    const ordinaryError = new SqlError({
      reason: classifySqliteError(new Error("write failed"), { operation: "migration insert" }),
    })
    const ordinary = await runExitWith(
      SqliteMigrator.run({ loader: SqliteMigrator.fromRecord({ "1_write": Effect.void }) }),
      makeSql({ insertError: ordinaryError }).sql,
    )
    expect(Exit.isFailure(ordinary)).toBe(true)
    if (Exit.isFailure(ordinary)) {
      expect(ordinary.cause.reasons.find(Cause.isFailReason)?.error).toBe(ordinaryError)
    }
  })
})
