# Compatibility harness

This package verifies that Better Native can replace selected Expo APIs without
changing observed behavior. It derives the compatibility denominator from pinned
Expo and Effect revisions, generates a runnable compatibility app, captures
immutable build and run evidence, and compares an upstream Expo baseline with a
candidate build that routes configured APIs to Better Native.

Run the CLI from the repository root through the `better-native` script:

```sh
bun run better-native --help
```

## What it owns

| Area                  | Source of truth                                           | Result                                                   |
| --------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| Pinned revisions      | `compatibility/upstreams.json`                            | The exact Expo and Effect sources being evaluated.       |
| Expo API denominator  | Expo package manifests and exports                        | Catalog, installation, surface, and ownership artifacts. |
| Replacement policy    | `compatibility/ownership.json`                            | Candidate module replacements and their rationale.       |
| Behavioral exceptions | `compatibility/expectations.json`                         | Explicitly allowed upstream/candidate divergences.       |
| Test denominator      | `compatibility/suites.json` plus the pinned Expo checkout | Discovered sources, cases, and runner plans.             |
| Run evidence          | `.artifacts/builds` and `.artifacts/runs`                 | Append-only records used for a compatibility verdict.    |

Generated application registry files live in
`apps/compatibility-suite/src/generated`. Do not hand-edit them; update the
inputs above and regenerate instead.

## Local setup

The harness must run from the Better Native repository root. It requires:

- Bun `1.3.14` (the version recorded in the root `package.json`);
- the `vendor/effect` submodule checked out at the revision in
  `compatibility/upstreams.json`; and
- a non-symlinked Expo checkout at the exact pinned revision. By default it is
  expected at `../expo`; set `EXPO_SOURCE_ROOT` to use another location.

```sh
git submodule update --init --recursive
bun install

# Clone Expo at the revision in compatibility/upstreams.json, then either:
export EXPO_SOURCE_ROOT=/absolute/path/to/expo

# Install Expo's dependencies and create the pinned toolchain evidence.
bun run expo:prepare
```

`expo:prepare` performs Expo's normal installation and validates the source
revision and required compiled artifacts. It can take a while. Copy
`.env.example` to `.env.local` for the available local environment defaults.

## Everyday commands

```sh
# Validate the pinned sources, surface lock, ownership configuration, and suite denominator.
bun run compatibility

# Regenerate the catalog and compatibility-app registry after changing a pin or policy.
bun run generate

# Fail if committed generated application outputs are stale.
bun run check:generated

# Print the current compatibility denominator and coverage report.
bun run matrix
bun run coverage
bun run better-native coverage --json

# Render Effect-native API reference Markdown from source TSDoc.
bun run docs:api

# Inspect installed Expo packages and expanded wildcard entrypoints.
bun run better-native doctor
```

`generate` also writes inspection artifacts under `.artifacts/compatibility`.
Those files are diagnostic outputs, while the generated files checked by
`check:generated` are part of the repository's compatibility app.

## Command reference

Root scripts are convenience aliases for harness subcommands. Prefer the root
scripts for common local workflows and `bun run better-native <subcommand>` when
you need flags that are not exposed by an alias.

| Command                                                             | Purpose                                                                                     | Primary output                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `bun run better-native validate` / `bun run compatibility`          | Validate pinned sources, surface lock, ownership policy, expectations, and suite discovery. | Terminal verdict.                                                            |
| `bun run better-native generate` / `bun run generate`               | Regenerate compatibility catalog artifacts and compatibility-suite generated files.         | `.artifacts/compatibility/*` and `apps/compatibility-suite/src/generated/*`. |
| `bun run better-native matrix` / `bun run matrix`                   | Print the current compatibility denominator.                                                | Terminal summary.                                                            |
| `bun run better-native doctor`                                      | Inspect installed Expo packages and expanded wildcard entrypoints.                          | Terminal diagnostics.                                                        |
| `bun run better-native coverage` / `bun run coverage`               | Print Better Native API coverage for replaced Expo packages.                                | Terminal table.                                                              |
| `bun run better-native coverage --json` / `bun run coverage --json` | Print machine-readable API coverage.                                                        | JSON object on stdout.                                                       |
| `bun run better-native security-audit` / `bun run security:audit`   | Audit dependency exceptions against reviewed Expo paths.                                    | Terminal verdict.                                                            |
| `bun run better-native update-surface-lock`                         | Deliberately update the pinned Expo surface lock after reviewing surface drift.             | `compatibility/surface-lock.json`.                                           |
| `bun run better-native prepare-expo` / `bun run expo:toolchain`     | Prepare and validate the pinned Expo toolchain.                                             | Toolchain evidence under `.artifacts`.                                       |
| `bun run better-native supervise-build`                             | Build one isolated upstream or candidate app.                                               | Build record JSON.                                                           |
| `bun run better-native supervise-build-pair`                        | Build upstream and candidate apps from one pinned Expo materialization.                     | Paired build records.                                                        |
| `bun run better-native supervise-web` / `bun run compatibility:web` | Build and execute an upstream or candidate web compatibility run.                           | Run evidence under `.artifacts/runs`.                                        |
| `bun run better-native supervise-web-pair`                          | Execute paired upstream and candidate web runs.                                             | Paired run evidence.                                                         |
| `bun run better-native probe-web`                                   | Probe one opaque Expo export resolution.                                                    | Probe JSON.                                                                  |
| `bun run better-native supervise-native`                            | Execute one generated source shard against an imported native build.                        | Native run evidence.                                                         |
| `bun run better-native supervise-native-pair`                       | Execute paired native shards against imported upstream and candidate builds.                | Paired native run evidence.                                                  |
| `bun run better-native supervise-external`                          | Execute one reviewed external-run request.                                                  | Normalized external evidence.                                                |
| `bun run better-native supervise-runner-plans`                      | Execute a shard of generated external runner plans.                                         | Runner-plan report JSON.                                                     |
| `bun run better-native compare-runs`                                | Compare upstream and candidate evidence and reject regressions or missing coverage.         | Differential verdict JSON.                                                   |

## Coverage report

`coverage` answers whether each configured Better Native package has a public API
corresponding to the Expo exports routed to it by the generated replacement
manifest. It is not native behavior evidence; behavior support still comes from
harness runs and comparison evidence.

The terminal report has one Expo package per row. It keeps comparison at the count level; use `--json` when you need per-export mappings.

Summary columns:

| Column            | Meaning                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Package`         | Expo package being replaced.                                                                                                   |
| `Expo exports`    | Runtime exports discovered from the generated Expo-compatible entrypoint.                                                      |
| `Covered exports` | Total Expo exports covered by Better Native, including Effect-native APIs, streams, and Expo-compatible exports.               |
| `Expo API`        | Expo async/value exports, excluding listener exports and React hooks.                                                          |
| `Effect API`      | Async/value exports represented by Effect-native public APIs.                                                                  |
| `Streams`         | Listener exports represented as scoped `Stream` APIs.                                                                          |
| `React hooks`     | Expo React hook exports covered by the generated Expo-compatible entrypoint.                                                   |
| `Effect atoms`    | Effect Atom exports for React integrations such as `@effect/atom-react`.                                                       |
| `Missing`         | Exports with no inferred Better Native public target.                                                                          |
| `Status`          | `complete` when no exports are missing or pending, `partial` when hooks are pending, or `missing` when exports have no target. |

Machine-readable mode prints per-export mappings in the `entries` array of a JSON object:

```json
{
  "schemaVersion": 1,
  "packages": [
    {
      "packageName": "expo-battery",
      "expoExports": 14,
      "expoApi": 7,
      "effectApi": 7,
      "effectStream": 3,
      "reactHooks": 4,
      "effectAtoms": 4,
      "reactHookPending": 0,
      "missing": 0,
      "status": "complete"
    }
  ],
  "entries": [
    {
      "packageName": "expo-battery",
      "expoExport": "getBatteryLevelAsync",
      "status": "effect-api",
      "target": "@better-native/battery#getLevel"
    },
    {
      "packageName": "expo-battery",
      "expoExport": "useBatteryLevel",
      "status": "expo-compat",
      "target": "@better-native/battery/expo#useBatteryLevel"
    }
  ]
}
```

Entry statuses are:

| Status               | Meaning                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `effect-api`         | The Expo export maps to an Effect-native value API.                                                            |
| `effect-stream`      | The Expo listener export maps to a scoped Effect `Stream`.                                                     |
| `expo-compat`        | The Expo export is covered by the generated Expo-compatible entrypoint rather than the Effect-native root API. |
| `react-hook-pending` | The Expo hook export has no Better Native public hook target yet.                                              |
| `missing`            | No Better Native public target was inferred.                                                                   |

Current coverage is expected to be `complete` for `expo-battery` and
`expo-network`. React hook exports are reported as `expo-compat` because hooks
belong to the Expo-compatible entrypoint. Effect-native React state should be exposed
through Effect atoms that can be consumed by packages such as `@effect/atom-react`.
A future package should not stay `partial` unless the pending surface is deliberate
and documented.

## Docs and docgen workflow

Public Effect-native API reference is generated with `@effect/docgen`:

```sh
bun run docs:api
```

Source TSDoc in public package source is canonical and reviewed. The harness does
not generate or rewrite those comments. This follows Effect's own pattern:
source comments describe the supported API, while `@effect/docgen` validates and
renders disposable Markdown.

Generated Markdown belongs under `.artifacts/docs/api/*` and should not be
edited. Compatibility reports and behavioral evidence are generated separately
from the API reference so API usage documentation is not mixed with compatibility
claims.

## Running compatibility checks

All build and run commands require a prepared pinned Expo checkout. Build IDs
must be safe path segments and should be unique, because evidence records are
immutable once written.

### Web

For an upstream-only local smoke test:

```sh
bun run compatibility:web
```

For the differential check, `GITHUB_SHA` identifies the candidate revision:

```sh
export GITHUB_SHA="$(git rev-parse HEAD)"
bun run better-native supervise-web-pair \
  --build-id local-web-pair \
  --timeout-ms 1500000 \
  --port 8091

bun run better-native compare-runs \
  --upstream .artifacts/runs/local-web-pair-upstream-run \
  --candidate .artifacts/runs/local-web-pair-candidate-run
```

`supervise-web` and `supervise-web-pair` accept `--source <source-id>` to run
one generated app source. `probe-web --specifier <expo-module>` is useful for
isolating the resolution behavior of a single Expo export.

### iOS and Android

Native execution is split so a release build can be made on one worker and
tested on another. Build first, package/import the resulting `.app` or APK,
then invoke `supervise-native` or `supervise-native-pair` with the build record,
binary path, device ID, and optional shard settings. The exact artifact handoff
and simulator/emulator setup used by CI are in
`.github/workflows/compatibility.yml`.

Useful platform requirements include Xcode and a booted iOS simulator for iOS,
or JDK 17, Android tooling, and an emulator for Android. Maestro is required for
the native app flows. Set `BETTER_NATIVE_IOS_DESTINATION` when the default iOS
destination is not appropriate.

### External runner plans

The generated runner-plan ledger accounts for Expo tests that cannot run inside
the compatibility app. Run a family or a shard with an explicit report path:

```sh
bun run better-native supervise-runner-plans \
  --runner jest \
  --shard-index 0 \
  --shard-count 1 \
  --timeout-ms 1200000 \
  --report .artifacts/runner-plan-report.json
```

`supervise-external --plan <path>` executes one reviewed external-run request.
Both commands normalize runner output before accepting it as evidence.

## Differential verdicts

`compare-runs` loads every `record.json` below the two supplied run roots. It
rejects missing evidence, candidate regressions, unapproved divergences,
incomplete source coverage, and candidate resolutions that do not match the
generated replacement manifest. Add a behavioral exception only when it is
intentional and reviewed, in `compatibility/expectations.json`.

Candidate routing is controlled by `compatibility/ownership.json`. After a
legitimate Expo surface change, review the generated surface and update the
lock deliberately:

```sh
bun run better-native update-surface-lock
bun run generate
bun run compatibility
```

## CI model

`.github/workflows/compatibility.yml` runs relevant upstream baselines on pull
requests and pushes. Scheduled runs, and manually dispatched pair runs, build
both upstream and candidate, upload their evidence, then make the differential
verdict in a separate comparison job. The scheduled profile sets
`BETTER_NATIVE_FORCE_COLD_BUILD=true` to exercise uncached build paths.

## Package layout

- `src/catalog/` reads the pinned Expo package and export surface.
- `src/policy/` validates ownership, surface locks, and expectations.
- `src/suites/` discovers and classifies the Expo test corpus.
- `src/registry/` generates compatibility-app sources and external runner plans.
- `src/build/` prepares Expo and creates isolated upstream/candidate builds.
- `src/supervision/` runs web, native, process, Maestro, and external runners.
- `src/evidence/` writes content-addressed build and run records.
- `src/comparison/` turns paired evidence into the compatibility verdict.
