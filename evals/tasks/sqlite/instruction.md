# SQLite

Implement `src/ReadTemporaryValue.ts` using only the installed public
`@better-native/sqlite` package and normal `effect/*` entrypoints.

Export `temporaryValue`, an Effect that:

- provisions `SqliteClient.layer({ databaseName: "dx.eval.sqlite" })` at the application boundary;
- creates a `values` table, inserts the parameterized value `"controlled-value"`, and reads it back;
- performs those operations in one Effect SQL transaction;
- returns the stored string; and
- preserves `SqlError` in the error channel when the read query fails.

The connection must be scoped so it closes after the Effect completes. Do not return a fixed value,
call `expo-sqlite` directly, or import better-native source files, package internals, or test doubles.
Do not add files or change the exported name.
