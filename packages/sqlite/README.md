# @better-native/sqlite

An Expo SQLite driver for Effect SQL, backed by `expo-sqlite`.

## Install

```sh
npx expo install expo-sqlite @better-native/sqlite@0.0.1-alpha.1 effect@4.0.0-rc.112
```

Manual equivalents are:

```sh
npm install expo-sqlite@">=57.0.0 <58.0.0" @better-native/sqlite@0.0.1-alpha.1 effect@4.0.0-rc.112
pnpm add expo-sqlite@">=57.0.0 <58.0.0" @better-native/sqlite@0.0.1-alpha.1 effect@4.0.0-rc.112
yarn add expo-sqlite@">=57.0.0 <58.0.0" @better-native/sqlite@0.0.1-alpha.1 effect@4.0.0-rc.112
bun add expo-sqlite@">=57.0.0 <58.0.0" @better-native/sqlite@0.0.1-alpha.1 effect@4.0.0-rc.112
```

`@better-native/sqlite` supports `expo-sqlite >=57.0.0 <58.0.0`. Use the project-local Expo CLI
so the provider version remains compatible with the app's Expo SDK.

When native SQLite build options are required, use the preserved plugin and regenerate CNG native
projects before rebuilding:

```json
{
  "expo": {
    "plugins": [["@better-native/sqlite/plugin", { "enableFTS": true, "useSQLCipher": false }]]
  }
}
```

The plugin also supports per-platform `android`/`ios` overrides, `useLibSQL`,
`withSQLiteVecExtension`, and `customBuildFlags`. Bare projects must apply the equivalent Gradle and
Podfile properties themselves. See the [Expo SQLite guide](https://docs.expo.dev/versions/latest/sdk/sqlite/).

## Effect SQL client

```ts
import { SqliteClient } from "@better-native/sqlite"
import * as Effect from "effect/Effect"

interface Todo {
  readonly id: number
  readonly title: string
}

const program = Effect.gen(function* () {
  const sql = yield* SqliteClient.SqliteClient

  yield* sql`CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL
  )`
  yield* sql`INSERT INTO todos (title) VALUES (${"Ship migration"})`

  return yield* sql<Todo>`SELECT id, title FROM todos ORDER BY id`
}).pipe(Effect.provide(SqliteClient.layer({ databaseName: "app.db" })))
```

The layer provides both `SqliteClient.SqliteClient` and Effect's generic `SqlClient` service. The
database connection is serialized and closes with the Layer scope.

## Transactions, streams, and migrations

Effect SQL supplies nested, interruption-safe transactions and parameterized tagged templates:

```ts
const insert = Effect.gen(function* () {
  const sql = yield* SqliteClient.SqliteClient
  return yield* sql.withTransaction(sql`INSERT INTO events (name) VALUES (${"opened"})`)
})
```

Statements expose `.stream`, `.values`, and `.raw`. The package also exports `SqliteMigrator`, which
uses Effect's shared migration loaders and schema table.

The client supports Effect SQL schemas, resolvers, tracing, result/query name transforms, and
reactivity. Set `openOptions.enableChangeListener` to connect Expo's update hook to Effect
reactivity using table names and changed row IDs.

Expo-specific operations remain available on the client as `export`, `loadExtension`, and
`syncLibSQL`.

## Expo-compatible import

For a low-churn migration, change only the module specifier:

```ts
import * as SQLite from "@better-native/sqlite/expo"
```

This entrypoint preserves Expo's classes, functions, hooks, synchronous behavior, and Promise return
shapes by identity. The `kv-store`, `localStorage/install`, `plugin`, and `app.plugin.js` subpaths are
also preserved. The root entrypoint is the Expo-backed Effect SQL driver and exposes scoped Effect
wrappers for database open, deserialize, backup, import, delete, and change-event operations.

## React state

Use `sqliteClientAtom` as the Effect-native replacement for Expo's `SQLiteProvider` and
`useSQLiteContext` pair. It opens the connection while the atom is mounted, exposes the complete
Effect SQL client, and closes it after the last consumer releases it:

```ts
import { sqliteClientAtom } from "@better-native/sqlite"
import { useAtomValue } from "@effect/atom-react"

const appDatabaseAtom = sqliteClientAtom({ databaseName: "app.db" })

const databaseResult = useAtomValue(appDatabaseAtom)
```

## Driver boundary

Effect includes `@effect/sql-sqlite-react-native`, but that package is specifically backed by
`@op-engineering/op-sqlite`. This package follows the same Effect SQL driver contract while using
Expo's native module, autolinking, configuration, web implementation, change events, extensions,
and libSQL integration.

The complete public Expo surface is implemented and owned by the compatibility harness. Paired
Release comparisons pass the reviewed Effect SQL round trip, transaction rollback, native change
event, Atom lifecycle, and direct Expo-provider agreement cases on web, iOS Simulator, and Android
API 36 with zero
divergences. Paired CNG also produces matching upstream and candidate native fingerprints on iOS
and Android.
