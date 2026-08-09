# better-native

Expo compatibility with an opt-in Effect-native API.

The repository contains an actively developed compatibility harness, opt-in Effect-native capability
packages, and a developer-experience eval harness. Compatibility evidence is derived from pinned
Expo and Effect revisions; DX evals separately test whether humans and coding agents can consume the
public Effect-native APIs correctly.

## Local Expo research source

Expo source is intentionally kept outside this repository so ordinary clones and deployments do not
download it. Clone the pinned revision next to this repository (the default is `../expo`) or copy
`.env.example` to `.env.local` and set `EXPO_SOURCE_ROOT` to another checkout. Compatibility CI
creates this source checkout explicitly when it needs Expo's internal test corpus.

```sh
bun install
bun run expo:prepare
bun run generate
bun run compatibility
bun run matrix
bun run check
```

The architecture and compatibility contract live in [docs/architecture.md](./docs/architecture.md).
The documentation target lives in [docs/documentation.md](./docs/documentation.md).
The human and agent developer-experience evaluation contract lives in
[docs/evals.md](./docs/evals.md).

Package guides:

- [Battery](./packages/battery/README.md)
- [Network](./packages/network/README.md)
- [KeepAwake](./packages/keep-awake/README.md)
- [SecureStore](./packages/secure-store/README.md)
- [SQLite](./packages/sqlite/README.md)
- [Task Manager](./packages/task-manager/README.md)
- [Background Task](./packages/background-task/README.md)
- [Location](./packages/location/README.md)
- [Notifications](./packages/notifications/README.md)
- [Metro integration](./packages/metro/README.md)

## DX eval status

The custom Vitest Evals harness, synthetic proof, and deterministic Network, Battery, KeepAwake,
SecureStore, SQLite, Task Manager, Background Task, Location, and Notifications baselines are implemented. Network covers
one-shot Effect adoption; Battery adds scoped Stream consumption and listener cleanup; KeepAwake
adds an interruption-safe scoped lease; SecureStore adds option forwarding, bracketed cleanup, and
typed native failures; and the background tasks cover eager headless definition, persistent
registration, and restricted-platform outcomes; Location covers scoped position Streams and native
subscription cleanup; Notifications covers scoped delivery Streams and listener cleanup. The OpenRouter
coding-agent adapter, reviewed five-model profiles, fake-model tests, and cost controls are also
implemented.
Required-gate outcomes are exposed as deterministic Vitest Evals judge scores; the current tasks do
not use a second LLM judge because their acceptance criteria are executable.
Per-trial provider cost is an observed post-response stop. The complete diagnostic campaign has an
in-process fail-fast USD 8.00 allocation, while the reusable dedicated OpenRouter key supplies a
reviewed USD 10.00 server-side ceiling on total eval-key exposure. A task-only diagnostic subset
retains a USD 2.50 allocation.
Candidate observations are produced through Effect `NodeWorker`/`NodeWorkerRunner` with a
nonce-authenticated protocol inside a rootless, non-root Podman sandbox. Evidence is single-use and
process-authenticated, and binds the
task instruction, private evaluator bundle, submission, gates, usage, and isolation policy.

The first paid blind diagnostic is preserved unchanged, but it has not been accepted or calibrated
as a performance baseline, so the repository does not currently claim a measured agent success rate
or that any current API is broadly “easy.” A one-trial `checkpoint-5-smoke` campaign validates paid
Network execution with the cheapest compatible profile before the reviewed Checkpoint 5 diagnostic
campaign runs five pinned models once on each of Network, Battery, KeepAwake, and SecureStore.
Deterministic validation is secretless and never makes provider calls; making it a required
branch-protection check remains an operator step.

The eval harness has a separate Vitest configuration and report path:

```sh
bun run evals validate
bun run evals smoke
bun run evals plan
# One paid Network smoke trial using the reusable dedicated eval key.
bun run evals plan --campaign checkpoint-5-smoke
bun run evals run --campaign checkpoint-5-smoke --confirm-paid
# Paid and credentialed; requires the reviewed key ceiling and explicit confirmation.
bun run evals run --confirm-paid
# Serves only the latest retained report by default.
bun run evals report
bun run evals report --campaign checkpoint-5-diagnostic
bun run evals report --all
```
