# Compatibility harness

This package verifies that Better Native can replace selected Expo APIs without
changing observed behavior. It derives the compatibility denominator from pinned
Expo and Effect revisions, generates a runnable compatibility app, captures
immutable build and run evidence, and compares an upstream Expo baseline with a
candidate build that routes configured APIs to Better Native.

Run the CLI from the repository root through the `compatibility-harness` script:

```sh
bun run compatibility-harness --help
```

The root `bun run test:coverage` command includes this harness's complete `src` controller as its
own coverage threshold group. This is separate from `bun run coverage`, which measures public Expo
API replacement coverage rather than executed TypeScript lines and branches. Child browser,
simulator, and external-runner execution is validated through supervision and paired evidence; it
is not falsely attributed to the parent Vitest V8 process.

## What it owns

| Area                  | Source of truth                                           | Result                                                   |
| --------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| Pinned revisions      | `compatibility/upstreams.json`                            | The exact Expo and Effect sources being evaluated.       |
| Expo API denominator  | Expo package manifests and exports                        | Catalog, installation, surface, and ownership artifacts. |
| Replacement policy    | `compatibility/ownership.json`                            | Candidate module replacements and their rationale.       |
| API migration mapping | `compatibility/api-mappings.json`                         | Reviewed exact-name Effect and Expo-compatible mappings. |
| Behavioral exceptions | `compatibility/expectations.json`                         | Explicitly allowed upstream/candidate divergences.       |
| Test denominator      | `compatibility/suites.json` plus the pinned Expo checkout | Discovered sources, cases, and runner plans.             |
| Run evidence          | `.artifacts/builds` and `.artifacts/runs`                 | Append-only records used for a compatibility verdict.    |

Generated application registry files live in
`apps/compatibility-suite/src/generated`. Do not hand-edit them; update the
inputs above and regenerate instead. API migration mappings are reviewed input,
not a second export denominator: the harness joins them to the exports derived
from pinned Expo and rejects duplicate, stale, renamed, or missing targets.

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
bun run compatibility-harness coverage --json

# Render Effect-native API reference Markdown from source TSDoc.
bun run docs:api

# Inspect installed Expo packages and expanded wildcard entrypoints.
bun run compatibility-harness doctor
```

`generate` also writes inspection artifacts under `.artifacts/compatibility`.
Those files are diagnostic outputs, while the generated files checked by
`check:generated` are part of the repository's compatibility app.

## Command reference

Root scripts are convenience aliases for harness subcommands. Prefer the root
scripts for common local workflows and `bun run compatibility-harness <subcommand>` when
you need flags that are not exposed by an alias.

| Command                                                                     | Purpose                                                                                     | Primary output                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `bun run compatibility-harness validate` / `bun run compatibility`          | Validate pinned sources, surface lock, ownership policy, expectations, and suite discovery. | Terminal verdict.                                                            |
| `bun run compatibility-harness generate` / `bun run generate`               | Regenerate compatibility catalog artifacts and compatibility-suite generated files.         | `.artifacts/compatibility/*` and `apps/compatibility-suite/src/generated/*`. |
| `bun run compatibility-harness matrix` / `bun run matrix`                   | Print the current compatibility denominator.                                                | Terminal summary.                                                            |
| `bun run compatibility-harness doctor`                                      | Inspect installed Expo packages and expanded wildcard entrypoints.                          | Terminal diagnostics.                                                        |
| `bun run compatibility-harness coverage` / `bun run coverage`               | Print Better Native API coverage for replaced Expo packages.                                | Terminal table.                                                              |
| `bun run compatibility-harness coverage --json` / `bun run coverage --json` | Print machine-readable API coverage.                                                        | JSON object on stdout.                                                       |
| `bun run compatibility-harness security-audit` / `bun run security:audit`   | Audit dependency exceptions against reviewed Expo paths.                                    | Terminal verdict.                                                            |
| `bun run compatibility-harness update-surface-lock`                         | Deliberately update the pinned Expo surface lock after reviewing surface drift.             | `compatibility/surface-lock.json`.                                           |
| `bun run compatibility-harness prepare-expo` / `bun run expo:toolchain`     | Prepare and validate the pinned Expo toolchain.                                             | Toolchain evidence under `.artifacts`.                                       |
| `bun run compatibility-harness supervise-build`                             | Build one isolated upstream or candidate app.                                               | Build record JSON.                                                           |
| `bun run compatibility-harness supervise-build-pair`                        | Build upstream and candidate apps from one pinned Expo materialization.                     | Paired build records.                                                        |
| `bun run compatibility-harness supervise-web` / `bun run compatibility:web` | Build and execute an upstream or candidate web compatibility run.                           | Run evidence under `.artifacts/runs`.                                        |
| `bun run compatibility-harness supervise-web-pair`                          | Execute paired upstream and candidate web runs.                                             | Paired run evidence.                                                         |
| `bun run compatibility-harness probe-web`                                   | Probe one opaque Expo export resolution.                                                    | Probe JSON.                                                                  |
| `bun run compatibility-harness supervise-native`                            | Execute one generated source shard against an imported native build.                        | Native run evidence.                                                         |
| `bun run compatibility-harness supervise-native-pair`                       | Execute paired native shards against imported upstream and candidate builds.                | Paired native run evidence.                                                  |
| `bun run compatibility-harness supervise-external`                          | Execute one reviewed external-run request.                                                  | Normalized external evidence.                                                |
| `bun run compatibility-harness supervise-runner-plans`                      | Execute a shard of generated external runner plans.                                         | Runner-plan report JSON.                                                     |
| `bun run compatibility-harness compare-runs`                                | Compare upstream and candidate evidence and reject regressions or missing coverage.         | Differential verdict JSON.                                                   |

## Coverage report

`coverage` answers whether each configured Better Native package has public values and types
corresponding to the Expo surface routed to it by the generated replacement
manifest. It is not native behavior evidence; behavior support still comes from
harness runs and comparison evidence.

The terminal report has one Expo package per row. It keeps comparison at the count level; use
`--json` when you need per-export and per-type mappings. The report derives separate runtime-value
and public-type denominators from the generated Expo-compatible entrypoints, then classifies each
entry with the reviewed explicit mapping. It does not infer correspondence from similar names.

Summary columns:

| Column            | Meaning                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `Package`         | Expo package being replaced.                                                                          |
| `Expo exports`    | Runtime exports discovered from the generated Expo-compatible entrypoint.                             |
| `Deprecated APIs` | Expo exports carrying reviewed deprecation metadata while retaining their primary API classification. |
| `Accounted`       | Expo exports with an explicit Effect-native, Expo-compatible, or intentional-divergence mapping.      |
| `Expo types`      | Public types discovered from the generated Expo-compatible entrypoint.                                |
| `Covered types`   | Expo public types with an exact Effect-native, Expo-compatible, or divergence mapping.                |
| `Missing types`   | Expo public types without an explicit reviewed type mapping.                                          |
| `Expo API`        | Expo async/value exports, excluding listener exports and React hooks.                                 |
| `Effect API`      | Async/value exports represented by exact-name Effect-native public APIs.                              |
| `Streams`         | Listener exports represented as exact-name scoped `Stream` APIs.                                      |
| `React hooks`     | Expo React hook exports covered by the generated Expo-compatible entrypoint.                          |
| `Effect atoms`    | Effect Atom exports for React integrations such as `@effect/atom-react`.                              |
| `Divergences`     | Expo exports with a documented intentional divergence.                                                |
| `Missing`         | Expo exports without an explicit mapping.                                                             |
| `Status`          | `complete`, `intentional-divergence`, or `missing`, based on the explicit mappings.                   |

Machine-readable mode prints runtime mappings in `entries` and public-type mappings in
`typeEntries`:

```json
{
  "schemaVersion": 5,
  "packages": [
    {
      "packageName": "expo-battery",
      "expoExports": 14,
      "deprecatedExpoApis": 0,
      "accountedExports": 14,
      "expoTypes": 6,
      "accountedTypes": 6,
      "effectTypes": 6,
      "expoCompatTypes": 0,
      "missingTypes": 0,
      "expoApi": 7,
      "effectApi": 7,
      "effectStream": 3,
      "reactHooks": 4,
      "effectAtoms": 4,
      "intentionalDivergences": 0,
      "missing": 0,
      "status": "complete"
    }
  ],
  "entries": [
    {
      "packageName": "expo-battery",
      "expoExport": "getBatteryLevelAsync",
      "status": "effect-api",
      "target": "@better-native/battery#getBatteryLevelAsync"
    },
    {
      "packageName": "expo-battery",
      "expoExport": "useBatteryLevel",
      "status": "expo-compat",
      "target": "@better-native/battery/expo#useBatteryLevel",
      "atomTarget": "@better-native/battery#batteryLevelAtom"
    }
  ],
  "typeEntries": [
    {
      "packageName": "expo-battery",
      "expoType": "BatteryLevelEvent",
      "status": "effect-type",
      "target": "@better-native/battery#BatteryLevelEvent"
    }
  ]
}
```

Entry statuses are:

| Status                   | Meaning                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `effect-api`             | The Expo export maps to an Effect-native value API.                                                            |
| `effect-stream`          | The Expo listener export maps to a scoped Effect `Stream`.                                                     |
| `expo-compat`            | The Expo export is covered by the generated Expo-compatible entrypoint rather than the Effect-native root API. |
| `effect-type`            | The Expo public type maps to an exact-name type exported by the Effect-native root entrypoint.                 |
| `expo-compat-type`       | The Expo public type is retained exactly by the generated Expo-compatible entrypoint.                          |
| `intentional-divergence` | The Expo export is deliberately not reproduced, with a required reason.                                        |
| `missing`                | No explicit Better Native runtime or public-type mapping exists.                                               |

React hook exports are reported as `expo-compat` because hooks belong to the Expo-compatible
entrypoint. Effect-native React state is exposed through exact semantic counterparts ending in
`Atom`, such as `batteryLevelAtom`, `networkStateAtom`, and `keepAwakeAtom`; atom counts are additive
and do not consume another Expo export. Deprecated Expo APIs remain visible in `Deprecated APIs`
while retaining their primary `effect-api`, `effect-stream`, or `expo-compat` classification.
Target validation rejects renamed or missing exports and checks callable Effect APIs, Streams, and
Atoms against their declared TypeScript categories. Duplicate and stale mappings fail before a
report can be accepted.
Intentional divergences remain
visible even when no exports are missing. Run `bun run coverage` for the current result instead of
copying a point-in-time total into documentation.

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
bun run compatibility-harness supervise-web-pair \
  --build-id local-web-pair \
  --timeout-ms 1500000 \
  --port 8091

bun run compatibility-harness compare-runs \
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

Both native commands accept `--source <source-id>` for an opt-in capability run. Pass the same
`--source` to `compare-runs` so completeness is checked against that reviewed source instead of the
full platform cohort. Omitting the flag preserves the fail-closed full-corpus comparison.

Useful platform requirements include Xcode and a booted iOS simulator for iOS,
or JDK 17, Android tooling, and an emulator for Android. Maestro is required for
the native app flows. Set `BETTER_NATIVE_IOS_DESTINATION` when the default iOS
destination is not appropriate.

### External runner plans

The generated runner-plan ledger accounts for Expo tests that cannot run inside
the compatibility app. Run a family or a shard with an explicit report path:

```sh
bun run compatibility-harness supervise-runner-plans \
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
bun run compatibility-harness update-surface-lock
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
