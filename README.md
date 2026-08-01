# effect-expo

An experimental, agent-verifiable Effect v4 platform that accounts for the public Expo SDK and progressively supplies verified Effect-native capability semantics.

The first prototype is `Network`: a deliberately small vertical slice used to assess the contract, generated-code, adapter, test-Layer, and CLI style before expanding the architecture.

```ts
import { Effect, Stream } from "effect"
import { Network, NetworkLive } from "@effect-expo/network"

const observeNetwork = Effect.gen(function* () {
  const network = yield* Network
  const current = yield* network.current
  yield* Effect.logInfo("current network state", current)

  yield* network.changes.pipe(
    Stream.runForEach((state) => Effect.logInfo("network changed", state))
  )
}).pipe(Effect.provide(NetworkLive))
```

What the prototype proves:

- a closed declarative capability specification generates an ordinary Effect v4 service;
- the reviewed Expo adapter owns normalization, typed failures, scoping, and spans;
- malformed native data fails as `NetworkContractViolation` instead of leaking partial values;
- a deterministic Layer distinguishes connection from internet reachability without native mocks;
- a generated SDK 57 catalog accounts for all 132 Expo-owned public-manifest or bundled candidates: 92 included and 40 explicitly excluded with reasons;
- `effect-expo check` detects generated drift and architectural boundary violations with stable diagnostics;
- shared current-state and listener-lifecycle vectors run against deterministic Layers and reviewed adapters;
- a real Expo Router test-suite app bundles through Metro and exposes live Network evidence.

Initialize a fresh checkout and install its pinned dependencies:

```sh
git submodule update --init --recursive
bun install --frozen-lockfile
```

Run the verification loop with Bun:

```sh
bun run check
bun run matrix
bun run bundle
```

`bundle` exports Android, iOS, and web. Use `bundle:android`, `bundle:ios`, or `bundle:web` for one platform. These are Metro/export smoke tests only.

Use `bun run conformance:ios` or `bun run conformance:android` to open the native test suite. A successful bundle is not recorded as platform conformance; the live vectors must pass on that platform.

### iOS simulator loop with `serve-sim`

`serve-sim` `0.1.45` is pinned as a root development dependency. It gives maintainers and coding agents a visible, controllable iOS Simulator while the Expo app remains the source of conformance results.

In one terminal, start Expo and open the booted iOS Simulator:

```sh
bun run conformance:ios
```

In another terminal, start the simulator helper and inspect its status:

```sh
bun run sim:ios -- --detach --quiet
bun run sim:ios -- --list
```

The detached helper defaults to the booted simulator and `127.0.0.1:3100`. Run `bun run sim:ios` without `--detach` when a human wants the browser preview. Useful agent-operated smoke-test controls include:

```sh
bun run sim:ios -- tap 0.5 0.44
bun run sim:ios -- permissions list
bun run sim:ios -- memory-warning
bun run sim:ios -- event-log --json --limit 50
```

The tap coordinates are normalized from `0` to `1`; the example targets the current **Run native vectors** button and must be updated if the screen layout changes. Pass `--device <udid-or-name>` to a control command when more than one simulator is booted. Stop the helper after the run:

```sh
bun run sim:ios -- --kill
```

`serve-sim` is an iOS observation and control surface, not a test oracle. A run counts only when the app records all vectors as `PASS`; coordinate taps, a successful Metro bundle, or a simulator stream do not count as evidence. Keep the default loopback host: `--host 0.0.0.0` exposes the preview on the LAN and is inappropriate for routine local or agent runs.

This is not yet the product moat. It is the smallest implementation that can falsify our architecture and establish code conventions. See [the architecture](docs/architecture.md) for the larger thesis and explicit kill criteria.

## Workspace layout

```text
apps/
└── test-suite/         # Expo Router app for live capability evidence
evals/
└── agent/              # Versioned agent tasks and comparison metrics
packages/
├── catalog/            # Generated Expo SDK inventory and coverage matrix
├── core/               # Shared declarative contracts and diagnostics
├── network/            # Network contract, reviewed Expo adapter, and testing
├── cli/                # Trusted generation/check tooling on effect/unstable/cli
└── typescript-config/  # Shared base, library, and Node compiler policy
```

The repository is a Bun workspace. Vendored Effect and Expo repositories remain research-only Git submodules and are deliberately excluded from the workspace graph. TypeScript `6.0.3` is the single authoritative compiler. `@effect/language-service` adds editor assistance and a separate unpatched diagnostics check; the repository never mutates the installed TypeScript compiler. Knip checks workspace dependency declarations, unused files, and excess exports through `bun run check:knip`, which is also part of `bun run check`.
