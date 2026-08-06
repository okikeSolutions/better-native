# Network

Implement `src/ReadNetwork.ts` using only the installed public `@better-native/network` package and
normal `effect/*` entrypoints.

Export:

- `NetworkSnapshot`, an Effect Schema for the output contract below; and
- `readNetwork`, one Effect operation that reads the current network state through
  `Network.getState` and has `Network.live` already provided. The exported Effect is the application
  boundary: it must have no remaining service requirements.

The operation must call the native read exactly once and succeed with one of these JSON values:

- `{ status: "available", state }` for a valid state;
- `{ status: "unavailable", method }` for `NetworkUnavailable`; or
- `{ status: "failure", method }` for `NetworkFailure`, including invalid native payloads.

The exported Schema must accept every declared output and reject missing or unknown status shapes.
Keep `NetworkUnavailable` distinct from `NetworkFailure`. Do not import `expo-network`, better-native
source files, package internals, or test doubles directly. Do not add files or change the exported
names.
