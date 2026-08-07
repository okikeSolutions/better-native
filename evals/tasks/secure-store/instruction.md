# Secure Store

Implement `src/ReadTemporarySecret.ts` using only the installed public
`@better-native/secure-store` package and normal `effect/*` entrypoints.

Export `temporarySecret`, an Effect that:

- stores `"controlled-secret"` under the key `"dx.eval.token"` with
  `{ keychainService: "dx-eval" }`;
- reads and returns that value with `SecureStore.getItemAsync`;
- always deletes the value after a successful write, including when reading fails;
- provides `SecureStore.live` at the application boundary; and
- preserves `SecureStoreFailure` in the error channel when native writing or reading fails.

Use an Effect acquire/use/release combinator so cleanup is resource-safe. Do not return a fixed
value, call `expo-secure-store` directly, or import better-native source files, package internals, or
test doubles. Do not add files or change the exported name.
