# Research: fast local verification and CI-only heavy evidence

Date: 2026-08-28

## Question

How should better-native preserve a trustworthy local verification path as each migrated Expo API adds package tests, installation tests, DX eval controls, and native parity work, while moving process-heavy verification to CI?

## Recommendation

Adopt three explicit verification lanes and make the migration ledger register work in each applicable lane:

1. **Unit lane — local and CI:** static checks, in-process unit tests, and in-process coverage. This is the default developer path and must not launch package managers, Podman, Metro, browsers, simulators, or emulators.
2. **Integration lane — CI required:** packed-package installation, CLI subprocesses, Podman compile/isolation checks, Metro/browser checks, and deterministic DX eval controls. Run this as an impact-selected matrix on pull requests and as a full matrix on `main` or a schedule.
3. **Parity lane — CI evidence:** upstream-versus-candidate web/native runs. Keep the existing platform change detection and one-release-shell reuse policy. Run affected capability/platform pairs on pull requests where practical and full pairs on scheduled/manual workflows.

Do not make one root Vitest invocation serve all three lanes. Use Vitest projects to classify test files, package-owned Turbo tasks to make unit and coverage work incremental, and CI matrices to parallelize integration work.

The intended commands should be:

```sh
bun run check:fast                  # all static checks + affected unit/coverage work
bun run verify:capability clipboard # one migration's complete local fast contract
bun run check:unit:all              # full in-process unit and coverage gate
bun run check:integration           # CI; optionally one capability/shard
bun run evals validate --task clipboard
```

`check:fast` and `verify:capability` should be safe to run repeatedly on a laptop. They should not silently skip a changed package. CI should run the same unit commands before adding integration and parity evidence.

## Repository observations

The current root `vitest.config.ts` changes the selected test files when `--coverage` is present. Coverage therefore adds deterministic eval files to the already broad host suite. This couples a measurement concern to integration execution.

Measured on this checkout:

| Invocation                                                                         | Test files | Tests | Wall time | Observation                                                                       |
| ---------------------------------------------------------------------------------- | ---------: | ----: | --------: | --------------------------------------------------------------------------------- |
| `bun run test`                                                                     |        121 |   587 |   48.82 s | Includes host tests that spawn expensive external work.                           |
| `bun run test:coverage`                                                            |        127 |   605 |   67.93 s | Adds eval controls and instruments both tooling trees.                            |
| Product-package tests excluding `PackedCli.test.ts` and `MetroIntegration.test.ts` |         25 |   182 |    1.16 s | Demonstrates that ordinary package behavior tests are already a viable fast lane. |

A JSON-timed package-oriented run identified the principal outliers:

- `PublishedCapabilityPackages.test.ts`: about 36.3 s;
- `MetroIntegration.test.ts`: about 5.5 s;
- `PackedCli.test.ts`: about 2.0 s;
- ordinary capability tests: generally below 0.4 s per file.

The present coverage failures also expose denominator problems rather than Clipboard gaps:

- CLI behavior runs mainly in subprocesses, so the parent Vitest V8 session reports about 1.8% package coverage;
- tiny config-plugin entrypoints pull Background Task branch coverage below its package threshold;
- all DX controller modules are included, while coverage executes deterministic controls for only a subset of tasks;
- Clipboard package runtime coverage is 100%, and its selected DX task controller is about 95% covered.

The testing documentation says external-process entrypoints should not be mixed into the in-process denominator, but the current broad globs include `packages/cli/src/**/*.ts`, `tooling/compatibility-harness/src/**/*.ts`, and `tooling/dx-evals/src/**/*.ts`. Configuration and policy are therefore out of alignment.

## Findings from primary sources

### Vitest supports projects for unit/integration separation

Vitest's official Projects guide recommends multiple named projects for tests requiring different configurations. Projects can use distinct `include` patterns such as `*.unit.test.ts` and `*.integration.test.ts`, and developers can select one with `--project`. Vitest also warns that coverage configuration is root-level for the whole process, so coverage should run only the selected unit project rather than trying to assign independent coverage policies inside each project.

Implication: define named `unit` and `integration` projects, but invoke coverage with only `--project unit`. Do not condition test selection on whether `--coverage` appears in `process.argv`.

Source: [Vitest — Test Projects](https://vitest.dev/guide/projects)

### Coverage should explicitly describe its denominator

Vitest states that `coverage.include` determines which source files enter the report, including files not imported by tests, and `coverage.exclude` removes intentional exclusions. Its V8 provider collects runtime coverage through V8 and can be slower when many modules are loaded because V8 cannot limit runtime collection to selected modules.

Implication: keep the denominator explicit and narrow enough to mean “code executable by this lane.” Product runtime modules belong in package coverage. Node/Podman/browser/device entrypoints do not belong in the parent Vitest denominator unless their execution coverage is deliberately imported and merged.

Source: [Vitest — Coverage](https://vitest.dev/guide/coverage)

### Vitest supports CI sharding and merged reports

Vitest officially supports file sharding with `--shard`, blob reports, and `--merge-reports`. Its feature documentation shows `--coverage` on shard runs and on the merge step. Sharding divides test files, not individual test cases.

Implication: use sharding for large controller/integration suites after classification. Do not use generic file sharding as the primary capability selector because one unusually expensive file can still dominate a shard; use capability/scope matrices first, then Vitest sharding inside a large homogeneous scope if needed.

Sources:

- [Vitest — Improving Performance: Sharding](https://vitest.dev/guide/improving-performance#sharding)
- [Vitest — Features: Sharding](https://vitest.dev/guide/features#sharding)

### Vitest recommends persistent transform caching for repeated focused runs

Vitest documents `experimental.fsModuleCache` as useful when repeatedly running a small test subset with a large module graph. The repository already enables this.

Implication: preserve the filesystem module cache for focused capability runs; it complements, but does not replace, separating expensive tests.

Source: [Vitest — Improving Performance: Caching Between Reruns](https://vitest.dev/guide/improving-performance#caching-between-reruns)

### Turborepo provides the required incremental execution model

Turborepo supports package filters, dependency/dependent filters, `--affected`, task-specific inputs, local and remote caching, and task outputs. `--affected` works at package level by default and requires sufficient Git history; shallow history can cause every package to be considered affected. Turborepo also states that cache correctness depends on declaring deterministic task inputs and outputs.

Implication: publishable capability packages should own `test:unit` and `test:coverage` tasks. Local checks can use `--affected`; CI must fetch enough history and set the PR base/head explicitly. Shared testing configuration, the lockfile, and relevant fixtures must be task inputs. External integration work should normally be uncached unless its complete environment is represented in the hash.

Sources:

- [Turborepo — `run` reference](https://turborepo.com/docs/reference/run)
- [Turborepo — Caching](https://turborepo.com/docs/crafting-your-repository/caching)
- [Turborepo — Skipping tasks](https://turborepo.com/docs/guides/skipping-tasks)

### Node can emit child-process V8 coverage, but that is a separate pipeline

Node's `NODE_V8_COVERAGE=dir` emits raw V8 coverage JSON, with source-map data where available. That mechanism is separate from Vitest's inspector-based coverage session.

Implication: do not expect CLI subprocess tests to raise Vitest's parent-process coverage. Prefer in-process unit tests for CLI application/services and retain packed CLI execution as integration evidence. If entrypoint execution coverage itself becomes a requirement, collect it as a dedicated Node coverage job and merge/remap it deliberately; do not make ordinary local coverage depend on that path.

Source: [Node.js — `NODE_V8_COVERAGE`](https://nodejs.org/api/cli.html#node_v8_coveragedir)

### GitHub Actions matrices fit capability-level integration work

GitHub Actions supports static and dynamically generated matrices and allows downstream jobs to consume matrix outputs/artifacts. GitHub also warns that workflow-level path filtering can leave required checks pending when the workflow never runs; skipped jobs, in contrast, report a successful skipped result.

Implication: always trigger the required verification workflow. Run a detector job inside it, generate the affected capability matrix, and finish with one stable required summary job using `if: always()`. Do not make changing matrix job names the branch-protection contract.

Sources:

- [GitHub Actions — Running variations of jobs](https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/running-variations-of-jobs-in-a-workflow)
- [GitHub — Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)

## Proposed test taxonomy

Use execution behavior, not importance, to classify a test.

### Unit

A unit test:

- runs inside the Vitest worker;
- uses in-memory or temporary-directory fakes;
- may compile TypeScript in-process if bounded and deterministic;
- does not invoke a package manager, container runtime, bundler server, browser, simulator, or device;
- owns in-process source coverage.

Naming: `*.unit.test.ts`, or retain `*.test.ts` as unit-by-default and require `*.integration.test.ts` for exceptions. Unit-by-default minimizes migration work and makes accidental heavy additions review-visible.

### Integration

An integration test does any of the following:

- spawns the packed CLI or a worker process;
- runs `npm pack`, installs from the local registry, or verifies published contents;
- invokes Podman, Metro, Playwright, Expo preparation, or repository-wide fixture builds;
- crosses a process boundary whose code is not attributed to Vitest coverage.

Naming: `*.integration.test.ts`. Existing clear candidates include:

- `packages/cli/test/PackedCli.test.ts`;
- `packages/metro/test/MetroIntegration.test.ts`;
- `tooling/compatibility-harness/src/installation/PublishedCapabilityPackages.test.ts`;
- Podman isolation/conformance files;
- process supervision and release-build smoke tests that launch real processes.

### Eval controls

Deterministic reference/no-op/broken controls are integration evidence, not coverage tests. Their pure grading, task-definition, workspace-policy, and protocol functions should have unit tests. Execute controls in CI by task/capability.

### Parity

Web, iOS, Android, and physical-device pairs remain evidence jobs outside Vitest coverage. Their success is represented by immutable records and comparison verdicts.

## Coverage design

### Product packages

Each publishable package should own a package-level coverage task. A shared helper should generate its Vitest configuration so thresholds do not drift:

```ts
export default defineProductCoverage({
  root: import.meta.dirname,
  include: ["src/**/*.ts"],
  exclude: ["src/bin.ts", "src/**/*.generated.ts"],
})
```

The default remains 95% statements/functions/lines and 90% branches. Exceptions must identify an external-process or generated entrypoint, not merely difficult code. For the CLI:

- unit-test `Application`, command construction, environment interpretation, and project edits in-process;
- exclude only the thin executable bootstrap if it contains no decision logic;
- retain packed CLI tests in integration CI.

### Tooling controllers

Replace broad “all files under `src`” globs with architectural scopes:

- include pure policy, planning, comparison, normalization, task-definition, and protocol modules;
- exclude `cli.ts`, worker scripts, process launch adapters, and environment-specific drivers unless tested in-process;
- move decision logic out of entrypoints so exclusions stay thin.

An explicit exported list from a shared coverage-policy module is preferable to scattered ignore comments. Add a test proving every controller source file is either covered by an in-process scope or declared as an external-process boundary with an associated integration test. This preserves the current anti-omission goal without manufacturing false zeroes.

### Do not merge unrelated denominators

A product package should pass or fail independently. Compatibility-harness and DX controller thresholds should also remain independent. CI does not need one repository-wide percentage. Separate matrix jobs can enforce each threshold directly; LCOV artifacts can still be combined for browsing if desired.

## Command and configuration layout

### Vitest

Use a shared base plus explicit entry configs:

```text
vitest.shared.ts
vitest.unit.config.ts
vitest.integration.config.ts
vitest.coverage.config.ts
vitest.evals.config.ts
```

Alternatively, use one root config with named `unit` and `integration` projects, plus a small coverage config that selects only `unit`. Avoid inspecting `process.argv` to mutate includes.

Recommended scripts:

```json
{
  "test": "bun run test:unit",
  "test:unit": "vitest run --config vitest.unit.config.ts",
  "test:coverage": "vitest run --config vitest.coverage.config.ts --coverage",
  "test:integration": "vitest run --config vitest.integration.config.ts",
  "check:unit:all": "turbo run test:coverage --concurrency=90%",
  "check:unit:affected": "turbo run test:coverage --affected --concurrency=90%"
}
```

Do not run `test:unit` and then rerun the same tests under `test:coverage` in one verification command. The coverage invocation already asserts test success.

### Turborepo

Add package/tooling tasks:

```json
{
  "test:unit": {
    "inputs": ["src/**", "test/**", "vitest.config.ts", "$TURBO_ROOT$/vitest.shared.ts"],
    "outputs": []
  },
  "test:coverage": {
    "inputs": ["src/**", "test/**", "vitest.config.ts", "$TURBO_ROOT$/vitest.shared.ts"],
    "outputs": ["coverage/**"]
  },
  "test:integration": {
    "cache": false
  }
}
```

Use a shared package-config factory or generated minimal package configs so every new migration gets the same thresholds and task names.

### Capability verifier

`verify:capability <id>` should read `compatibility/capabilities.json`, not maintain another hand-written registry. It should validate the ID and run:

1. package `typecheck`, `check:effect`, docs, and package coverage;
2. the capability's Expo compatibility unit tests;
3. compile-contract unit tests;
4. generated registry validation;
5. `migration-status --strict`.

It should print the CI-only obligations that remain, with their workflow/job identifiers, rather than pretending local success is full parity.

## CI topology

### Required fast job

One stable job runs on every pull request:

```text
static checks
migration-status --strict
all or affected package coverage
controller unit coverage
```

For maximum confidence, static policy/ledger/generated checks should remain repository-wide because they are relatively cheap and guard cross-package consistency. Package coverage can be affected-only on pull requests if full coverage runs on `main` and nightly.

### Required integration matrix

A detector reads the Git diff and ledger to output capability IDs. Rules:

- capability package, fixture, docs, or mapping change: select that capability;
- shared Expo-entrypoint generator, Metro replacement, harness execution, eval framework, lockfile, or CI setup change: select all capabilities affected by that subsystem;
- unclassifiable shared change: fail open by selecting all, never by selecting none.

Matrix dimensions should be semantic, for example:

```yaml
include:
  - capability: clipboard
    suite: install
  - capability: clipboard
    suite: eval-controls
  - capability: clipboard
    suite: web-compat
```

Large homogeneous Vitest integration groups can add file shards and merge blob reports. Capability matrices should remain the first partition because they produce actionable failures and align with the ledger.

### Stable required result

Keep the workflow unconditionally triggered. Add a final job with a stable name such as `Verification required` that:

- uses `if: always()`;
- depends on detector, fast, and integration jobs;
- fails if any required selected job failed or was cancelled;
- succeeds when an integration matrix was intentionally empty.

Require only this stable job in branch protection. This avoids GitHub's documented pending-check problem with workflow-level path filters.

### Main and scheduled runs

- `main`: full package/controller coverage and full secretless integration matrix;
- schedule: full compatibility pairs and cache-hygiene/cold-build checks;
- manual protected environment: paid eval campaigns and physical-device evidence.

## Ledger changes

Extend each capability record with machine-checkable verification ownership rather than encoding it only in prose:

```json
{
  "verification": {
    "unitProject": "@better-native/clipboard",
    "coverageScope": "packages/clipboard/src/**/*.ts",
    "integrationSuites": ["published-install", "eval-controls"],
    "parityPlatforms": ["web", "ios", "android"]
  }
}
```

Strict migration status should prove:

- the package has unit and coverage tasks;
- the coverage scope resolves to runtime files and thresholds;
- every integration suite maps to an existing CI matrix handler;
- every eval capability has task-selectable deterministic controls;
- reviewed parity platforms have evidence requirements and workflow routes.

This keeps the original ledger objective: agents cannot omit a lane simply because the local fast command does not execute it.

## Rollout plan

1. **Classify without behavior changes.** Introduce unit/integration configs and move the three measured outliers plus obvious Podman/process tests into integration selection.
2. **Make coverage honest.** Add package-owned coverage tasks, unit-test CLI decision logic in-process, and declare thin external-process boundaries explicitly.
3. **Add focused commands.** Implement `check:fast` and ledger-driven `verify:capability`.
4. **Move heavy tests to CI matrix.** Split deterministic eval controls and installation/process tests by capability or subsystem.
5. **Add the stable required summary job.** Keep workflows unconditional and selection internal.
6. **Extend strict ledger validation.** Require unit, coverage, integration, eval, and parity routing for new migrations.
7. **Measure and enforce budgets.** Record cold and warm timings. A reasonable initial target from current measurements is under 10 seconds for capability verification after typecheck caches are warm and under 30 seconds for repository-wide local fast verification. Treat regressions as test-classification failures rather than continually raising the budget.

## Rejected alternatives

### Keep one full coverage invocation and shard it locally

This still starts integration dependencies, preserves false subprocess zeroes, and grows total laptop work. Sharding improves CI elapsed time but not total local cost or denominator quality.

### Lower thresholds until the current command passes

This hides the execution-boundary mismatch and weakens product guarantees. Clipboard already demonstrates that package-level in-process coverage can meet the current threshold.

### Collect every subprocess into one coverage report

Node coverage can support a dedicated CLI job, but Podman, Metro/browser, simulator, and device execution require different collectors and source-map handling. Combining all of them would make routine coverage slow and brittle. Observable integration/parity evidence is the correct guarantee for those boundaries.

### Run only changed tests with raw Git path filters

Path filters do not understand package dependency graphs, shared harness impact, or ledger relationships. Turborepo's affected graph and a capability-aware detector provide safer selection, with an “all” fallback for shared changes.

## Conclusion

The repository does not need a weaker local gate. It needs a narrower, semantically correct one. Ordinary product tests already complete in roughly one second once the measured integration outliers are removed. Make that in-process lane the local coverage contract, use Turborepo for affected package execution, and move process/native evidence into capability-aware CI matrices. Extend the ledger so CI-only obligations remain enforced even though the laptop fast path does not execute them.
