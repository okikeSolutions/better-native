# Keep Awake

Implement `src/HoldScreenAwake.ts` using only the installed public
`@better-native/keep-awake` package and normal `effect/*` entrypoints.

Export `holdScreenAwake`, an Effect that:

- acquires `KeepAwake.keepAwake` with the tag `dx-eval`;
- stays alive until interrupted;
- provides `KeepAwake.live` at the application boundary; and
- preserves `KeepAwakeUnavailable` and `KeepAwakeFailure` in the error channel.

The Effect must be resource-safe: interruption must deactivate the same `dx-eval` lease exactly
once. Do not call `expo-keep-awake` directly or import better-native source files, package internals,
or test doubles. Do not add files or change the exported name.
