# Developer-experience evaluation

## Purpose

better-native aims to support two separate product claims:

1. selected APIs preserve the behavior of the pinned Expo source; and
2. humans and coding agents can correctly opt into, use, and extend the Effect-native API with
   measured and acceptable friction for a declared task and population.

The compatibility harness is the primary evidence for the first claim. The developer-experience
eval suite is the primary evidence for the second. Unit tests, coverage, compatibility evidence,
and DX evals may contribute to more than one analysis, but one evidence layer cannot substitute for
another layer's missing proof.

The human consumer DX target is:

> Given a supported task, a working Expo application, and the declared public documentation bundle,
> a developer in a recorded experience stratum can migrate one capability to the Effect-native API,
> preserve the rest of the application, retain typed failures, and produce code that passes the
> task's host-side checks without inspecting better-native implementation internals.

The agent consumer target replaces the human experience stratum with an exact agent-configuration
population and sampling policy. The human contributor DX target is:

> Given a manifest-hashed better-native source export and an issue-style task, a contributor in a
> recorded experience stratum can implement or extend an Effect-native capability by following the
> repository architecture and established package conventions, without inventing a package-specific
> integration model or modifying unrelated infrastructure.

The agent contributor target likewise uses an exact agent-configuration population rather than a
human experience stratum. Human and agent evidence are never substituted for one another.

These targets describe task outcomes, not preferred implementation text. A valid solution need not
match a reference patch. Results support claims only about the declared task distribution,
participant population, agent configuration, documentation bundle, and run conditions. The initial
suite is formative evidence; it does not establish that the entire product is easy for every human
or agent.

Correctness and friction are separate endpoints. Task success establishes correctness only. A claim
of acceptable or reduced difficulty additionally requires a pre-registered endpoint such as success
within a justified time and assistance budget, plus a declared comparator such as a prior release or
an equivalent direct-Expo workflow. Until a task has that endpoint and comparator, duration,
assistance, tool use, and documentation use remain descriptive friction signals rather than evidence
that adoption is easy.

## Non-goals

The DX eval suite does not:

- replace host tests or the coverage gate;
- establish iOS, Android, or web parity with Expo;
- rank foundation models in isolation from their agent harnesses;
- operate as a public or contamination-resistant model benchmark;
- require an LLM judge for behavior that code can verify;
- treat completion time, token count, or edit size as proof of correctness; or
- expose private implementation source to a consumer task merely to improve its pass rate.

Native parity remains governed by [the testing strategy](./testing.md). Effect-native API and guide
content remain governed by [the documentation architecture](./documentation.md).

## Evaluation model

The suite uses the following terms:

- **Task**: one instruction, starting environment, resource policy, and set of success criteria.
- **Trial**: one attempt by a particular human or agent configuration to complete a task.
- **Agent configuration**: the model, coding harness, system instructions, tools, permissions, and
  reasoning settings used for a trial.
- **Transcript**: the ordered messages, tool calls, and tool results exposed by an adapter during a
  trial.
- **Outcome**: the submitted patch, declared output files, clean-room grader results, and any
  explicitly submitted result.
- **Grader**: deterministic or reviewed logic that scores one dimension of the outcome.
- **Reference solution**: a known-valid solution used to prove that the task and graders are
  satisfiable.
- **Runtime-withheld material**: checked-in grader or reference material excluded from the
  agent-visible export. It is not confidential and may be contaminated.
- **Protected holdout**: a task, grader, or reference retained outside the public repository and
  unavailable to the evaluated system before its trial. At execution, only the trial-visible
  instruction and fixture are released to that one isolated trial; verifier-only material remains
  controller-only.
- **Evaluation harness**: infrastructure that materializes a task, runs a trial, captures evidence,
  invokes graders, and reports results.

The submitted patch and declared output files are authoritative for a coding outcome. An agent's
final message cannot turn a failing submission into a passing task, and a successful submission is
not rejected merely because the final message uses different prose. Required verification replays
the submission in a pristine verifier environment; it never trusts workspace-owned scripts,
configuration, dependencies, or result files merely because they exist in the final workspace.

## Suites

### Consumer adoption

Consumer tasks evaluate the published product boundary. A task receives:

- a minimal working Expo fixture;
- packed or installed public better-native packages;
- public package declarations, generated API documentation, handwritten guides, and either
  versioned snapshots or a reviewed domain allowlist for required upstream documentation;
- the normal TypeScript and Effect diagnostics available to an application developer; and
- a natural-language task with explicit observable requirements.

It does not receive better-native package source, private harness code, runtime-withheld graders, or
reference solutions. If a consumer trial must inspect `packages/*/src` to succeed, the trial has not
demonstrated that the public product is discoverable.

The consumer population is stratified at minimum by Expo familiarity and Effect familiarity.
Results for a stratum are not generalized to other experience levels. The task catalog declares the
supported capability universe and the provenance and weight of each task; convenience-selected
initial tasks are reported individually and are not treated as a representative product-wide
sample.

Initial consumer capabilities should cover:

- a one-shot native read;
- distinct handling of typed unavailable and native-failure cases;
- Layer provisioning at an application boundary;
- a scoped Stream subscription and cleanup;
- React Atom consumption;
- testing application code with a fake Layer; and
- migration of one Expo capability while unrelated Expo imports remain unchanged.

### Contributor development

Contributor tasks evaluate repository regularity. A task receives a deterministic, manifest-hashed
source export from a pinned revision plus an issue-style request. The export contains the source and
documentation a normal contributor needs, but excludes `.git`, all reference solutions, all grader
code, `tooling/dx-evals/**`, `evals/**`, previous artifacts, host secrets, runner configuration,
credential files, and trusted workflow state. Repository-owned build and development configuration
remains available. A task-specific overlay may represent uncommitted eval development, and its
digest is recorded separately from the base revision. Export conformance tests assert every denied
path is absent.

Initial contributor capabilities should cover:

- adding a simple read-only Effect service;
- translating native rejection and invalid payloads into reviewed tagged failures;
- adapting a callback API into a scoped Stream;
- adding public TSDoc and a compiling example; and
- adding host tests without weakening the compatibility denominator.

## Task definition

Public development and regression tasks may own:

```text
evals/tasks/<task-id>/
  instruction.md       Human-readable requirements
  task.json             Versioned configuration and metadata
  fixture/              Immutable starting workspace or fixture inputs
  reference.patch       Known-valid, runtime-withheld solution
  grader/               Runtime-withheld data and declarative grader configuration
```

Because checked-in references and graders are public, they are runtime-withheld rather than secret.
The trial export excludes them and contains no Git history from which they can be recovered.
Protected holdout tasks and verifier bundles live outside the public repository and are referenced
only by an opaque version and content digest in public results.

All executable grader implementations and TypeScript for task loading, agent adapters,
verification, and reduction belong in the private `tooling/dx-evals` workspace. That workspace owns
a package manifest, TypeScript project, Effect diagnostics, tests, and Knip coverage. It is an
Effect-native application: domain models use `Schema`, expected failures use typed Effect error
channels, dependencies are services supplied by `Layer`, and temporary workspaces, processes,
sandboxes, and report servers use scoped resource lifecycles. Its tests use `@effect/vitest` where
they exercise Effect programs. Promise-, callback-, SDK-, container-, and Vitest-specific APIs are
kept at narrow adapters and lifted into Effect rather than becoming the orchestration model.

The workspace imports Effect through normal package entrypoints such as `effect/Effect` and
`effect/Schema`, using the exact root dependency version associated with the revision recorded for
`vendor/effect`. It does not import source files through `vendor/effect` paths. The vendored checkout
is the pinned authoritative source and research reference; the installed `effect` package is the
compilation and runtime boundary. Dependency and revision identities are recorded in eval evidence.
`evals/tasks/*/grader` is data-only: fixtures, expected values, and declarative grader configuration.
`evals/tasks` is not an unchecked executable-code root.

The task schema must include at least:

- a stable ID, schema version, task version, suite, and capability tags;
- the fixture and instruction locations;
- the allowed documentation and network policy;
- wall-clock, turn, token, and cost limits when applicable;
- the number of trials requested by a run profile;
- required graders and diagnostic graders;
- the runtime and resource requirements that can affect the result;
- the participant or agent population for which the task is intended;
- a pre-outcome structural difficulty profile covering required concepts, API surface, files or
  subsystems touched, expected prerequisite knowledge, and permitted assistance;
- task provenance, author exposure, public or holdout status, and contamination status; and
- the exact evidence claim that a passing result is allowed to support.

Everything a required grader checks must follow from the instruction. The instruction should state
observable requirements and constraints without prescribing one exact patch. Task metadata and
grader commands are reviewed executable configuration; they may invoke only the narrow command set
owned by the DX harness.

Difficulty labels are frozen before evaluated outcomes are inspected and are validated through task
author review and a blind pilot. They describe the task structure, not the observed model pass rate.
Reports stratify by the declared dimensions and do not collapse them into an unsupported single
"easy," "medium," or "hard" scale.

Contributor tasks use a pinned `baseRevision` and deterministic export/overlay instructions rather
than duplicating a repository checkout inside each fixture. Consumer fixtures are content-addressed
application directories. Their preflight produces package tarballs, public documentation, and an
offline dependency closure, asserts that no dependency or symlink resolves into the source
checkout, and records all relevant digests before agent execution.

## Grading

Use the fastest reliable grader for each property. Prefer ordinary Vitest assertions and
deterministic custom judges over model grading.

### Required gates

A consumer task normally gates on:

- strict TypeScript compilation;
- strict Effect language-service diagnostics;
- task-specific behavioral tests against controlled native doubles;
- supported public entrypoints only;
- preservation of typed failures;
- absence of unsafe casts or failure erasure introduced to bypass the task;
- preservation of unrelated Expo imports and native configuration; and
- no deletion, weakening, or replacement of supplied tests.

A contributor task additionally gates on the repository checks relevant to the requested change,
package boundary rules, public documentation requirements, and unchanged compatibility truth unless
the task explicitly requires a reviewed ownership change.

Every gate has a versioned executable definition, positive and negative fixtures, and a declared
`pass`, `fail`, `unknown`, or `infrastructure-error` result. Terms such as "unsafe cast",
"unrelated change", and "failure erasure" are not grader specifications by themselves. Static
analysis that cannot establish a property returns `unknown`. Required-gate success means every
required gate returned `pass`; `unknown` never counts as a required pass. A non-blocking criterion is
diagnostic rather than required. Human adjudication may resolve an unknown only through a separately
recorded reviewed verdict.

The verifier does not execute workspace-owned package scripts, compiler configuration, test
discovery, loaders, dependency hooks, or result files as trusted infrastructure. It validates a
bounded submission archive, applies the submitted patch to a pristine source export, restores the
canonical dependency closure, injects verifier-owned configuration and tests, and invokes pinned
grader-owned binaries with fixed arguments. Allowed-path rules are checked before execution.

DX behavior grades prove task-local host correctness against controlled doubles. They do not prove
native behavior or Expo parity. Every report carries that limitation and links to the evidence
standard in [the testing strategy](./testing.md#evidence-standard).

### Diagnostic scores

The suite may report non-blocking dimensions such as:

- unnecessary files changed;
- edit size;
- end-to-end completion duration;
- time to the first agent-visible passing check;
- turns and tool calls;
- tokens and inference cost;
- documentation pages consulted; and
- recovery after the first agent-visible failed check, classified by a frozen failure and recovery
  taxonomy.

These metrics help locate friction. They must not be combined into an unexplained quality score or
used to override a failed correctness gate.

Every diagnostic metric declares its capture coverage. Missing adapter data is reported as
`unobserved`, never as zero. Human self-report, agent trace observation, and verifier observation are
distinct sources and are not silently combined.

### Model graders

An LLM judge is allowed only for a criterion that deterministic checks and practical human review
cannot express. It requires:

- one narrow dimension per rubric;
- explicit pass, fail, and unknown outcomes;
- a pinned judge configuration;
- calibration against reviewed human labels;
- stored rationale and disagreement evidence; and
- periodic revalidation.

No initial better-native task requires an LLM judge.

## Task validation

Every task must pass its own validation before it can measure an agent:

1. The pristine fixture installs and represents the intended starting state.
2. The pristine fixture fails the task-specific success condition where applicable.
3. The reference solution passes every required grader.
4. At least one deliberately broken solution fails the appropriate grader.
5. A superficial or known shortcut cannot receive credit without completing the task.
6. Reasonable alternative implementations are not rejected by exact-diff or incidental formatting
   checks.
7. At least one blind pilot who did not author the task or grader passes using only trial-visible
   resources, or a reviewed adjudication establishes that a failure was unrelated to ambiguity or
   missing resources and the revised task is piloted again.
8. Where practical, a second materially different valid solution passes the graders.

Task validation records which information the author and reference solution used. A reference
solution proves satisfiability, not discoverability; the blind pilot is the minimum discoverability
check.

A repeated zero-percent result is first treated as a possible broken task, ambiguous instruction,
or harness failure. It is not automatically evidence that all evaluated agents lack the capability.

## Harness architecture

The harness core is composed as an Effect program. Task repositories, export construction, agent
adapters, isolation backends, verification, evidence storage, clocks, identifiers, and configuration
are explicit services. The executable entrypoint builds one `ManagedRuntime` from the application
`Layer` and `NodeServices.layer` from `@effect/platform-node/NodeServices`. That runtime owns the
Layer scope, serves every custom-harness invocation in its process, and is disposed exactly once
when the eval process finishes. A trial never constructs or provides the production Layer again.
Services do not read `process.env`, instantiate model clients, or acquire global filesystem and
process dependencies internally. This follows the same `NodeServices` base layer and
host-configuration boundary as the compatibility harness while using `ManagedRuntime` for the
repeated Promise entrypoints required by Vitest Evals.

DX evals use Vitest Evals for suite authoring, normalized run data, assertions, artifacts, and
reporting. They run under a dedicated `vitest.evals.config.ts`; long timeouts, provider settings,
and eval reporters must not leak into ordinary unit tests. The configuration enables both
`vitest-evals/reporter` and Vitest's JSON reporter; every run uses a collision-proof, bounded JSON
output path beneath `.artifacts/evals`.

Vitest Evals is not a security, process-supervision, resource-enforcement, or durable-storage
boundary. Its custom harness adapts one trial into normalized JSON data for assertions and reports.
better-native therefore uses a staged trust pipeline:

```text
describeEval
  -> createHarness<TrialInput, TrialOutcome>
       -> dxEvalRuntime.runPromise(runTrial(input))
            -> prepare isolated workspace
            -> execute agent
            -> validate submission
            -> run clean-room graders
            -> authenticate evidence
       -> normalized Vitest Evals result
  -> deterministic assertions
  -> JSON and local report UI
```

`createHarness()` is the integration boundary because the evaluated application is a custom coding
workflow rather than one of Vitest Evals' first-party model-runtime adapters. The callback is a
small Promise boundary around the managed Effect runtime; it does not own orchestration, Layer
construction, or runtime disposal. The runtime entrypoint is:

```ts
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"

const MainLayer = DxEvalLive.pipe(Layer.provideMerge(NodeServices.layer))

export const dxEvalRuntime = ManagedRuntime.make(MainLayer)
```

`DxEvalLive` composes the task repository, exporter, adapter registry, isolation backend, verifier,
evidence store, clock, identifier, and configuration Layers. The executable integration that owns
`dxEvalRuntime` also owns its process-level shutdown hook and awaits `dxEvalRuntime.dispose()` once.
The custom adapter reuses that runtime:

```ts
import { createHarness } from "vitest-evals"
import { dxEvalRuntime } from "./DxEvalRuntime.js"

export const dxHarness = createHarness<TrialInput, TrialOutcome>({
  name: "better-native-dx",
  run: async ({ input, setArtifact }) => {
    const outcome = await dxEvalRuntime.runPromise(runTrial(input))

    setArtifact("evidence-reference", {
      runId: outcome.runId,
      manifestDigest: outcome.publicEvidenceManifest.digest,
    })

    return {
      output: outcome,
      events: outcome.transcript,
      usage: outcome.usage,
    }
  },
})
```

The task schema supplies `TrialInput`; the trusted controller constructs `TrialOutcome`. The
artifact contains only a bounded public reference to authenticated evidence. It never contains a
publication credential, concealed grader material, or authority to replace the evidence manifest.
Every returned `events` array contains at least one ordered canonical transcript event.

Eval files invoke that harness once per case and assert deterministic gates:

```ts
import { expect } from "vitest"
import { describeEval } from "vitest-evals"
import { dxHarness } from "./DxHarness.js"

describeEval("network adoption", { harness: dxHarness }, (it) => {
  it("preserves typed failures", async ({ run }) => {
    const result = await run(networkTypedFailureTrial)

    expect(result.output.infrastructureStatus).toBe("valid")
    expect(result.output.requiredGates.length).toBeGreaterThan(0)
    for (const gate of result.output.requiredGates) {
      expect(gate.result, gate.id).toBe("pass")
    }
  })
})
```

The initial implementation uses this lightweight normalized return. It returns a complete
Vitest Evals `HarnessRun` only if direct control of its session, timings, traces, artifacts, and
error representation becomes necessary; a complete run must already contain canonical
`session.events`. In either form, the trusted evidence manifest remains authoritative.

The custom-harness adapter sits outside the security pipeline it reports:

```text
trusted preparation
  -> secretless disposable agent environment
  -> validated regular-file submission archive
  -> trusted verifier controller
       -> nested untrusted submission sandbox
  -> trusted evidence publication
```

Trusted preparation creates the manifest-hashed source or consumer fixture export, materializes its
reviewed offline dependencies and documentation, and starts an agent environment with only declared
inputs. The agent phase invokes the selected human or coding-agent adapter and writes only inside
its disposable environment. Destroying that environment, rather than killing a parent process,
terminates the phase.

The transfer boundary accepts only declared regular files beneath normalized relative paths. It
rejects symlinks, hardlinks, devices, sockets, FIFOs, path traversal, case-colliding names, excessive
file counts or sizes, undeclared paths, and malformed archives. The archive manifest records path,
mode, size, media type, and content hash.

The verifier is a trusted controller in a fresh environment with no agent credentials and no
writable connection to the agent environment. It owns grader implementations, expected data,
outcome construction, and the authenticated publication channel. The controller applies the
validated submission to pristine inputs and revalidates the complete reconstructed tree before any
execution. Patch parsing rejects symlink, hardlink, gitlink, special-file, forbidden-mode,
undeclared-path, and traversal operations; post-apply validation repeats the path, type, count, size,
case-collision, ownership, and dependency-resolution checks.

The controller never executes submitted code with its own authority. It launches a nested untrusted
submission sandbox with a separate filesystem identity and minimum behavioral input surface.
Canonical dependencies and binaries are read-only; writable caches are disposable and never
trusted. The sandbox cannot read grader implementations, expected data, controller memory, outcome
paths, or publication credentials. The controller treats missing, malformed, early-exit, duplicate,
forged, or unverifiable execution reports as failure and produces the complete `TrialOutcome`, even
when one grader fails. Vitest assertions render required gates; deterministic custom judges may add
named scores and rationales.

For protected holdouts, the controller exposes concealed behavioral challenges only through a
constrained black-box protocol. Neither the submission sandbox nor submitted code receives the
grader bundle, reference solution, expected values, or concealed test source. If a task cannot keep
its supposedly concealed material outside submitted-code reach, it is labeled exposed and retired
from contamination-resistant use after that trial rather than reported as a protected holdout.

One Vitest case invokes the custom harness exactly once and represents one trial. Repeated trials are
expanded into distinct cases with collision-proof run IDs. A repository-owned reducer consumes the
Vitest JSON artifacts and calculates cross-trial metrics; the Vitest Evals report UI is a run
inspection surface, not the aggregate statistical implementation.

Agent adapters are replaceable. A task must not depend on Codex-, Claude-, or model-specific prompt
text unless the task explicitly evaluates that integration. The evaluated system identity includes
the model and the complete coding harness; results must not be attributed to the model alone.

Adapters translate messages and real tool calls/results into the Vitest Evals transcript model.
Process lifecycle, filesystem, and supervisor events are stored as bounded trace spans or evidence
records rather than invented transcript event types. Limits and usage fields are classified as
`requested`, `enforced`, `observed`, or `unavailable`; a cooperative abort signal is not reported as
an enforced process or resource limit.

Every harness result contains at least one canonical ordered transcript event, as required by the
Vitest Evals custom-harness contract. Reference and no-op adapters record the task instruction as a
user message and the adapter disposition as an assistant message.

## Isolation and security

Every agent phase runs in a disposable VM, container, or equivalent enforced sandbox appropriate to
the task. A directory or current-working-directory convention is not a security boundary. The
isolation backend must pass conformance tests for filesystem mounts, environment scrubbing, process
termination, network policy, resource enforcement, and artifact separation before its results may
be labeled isolated.

The agent environment has a new home directory, no host checkout or `.git` mount, no previous trial
state, no signing identity, no deployment or remote-cache credentials, no Git credential helper,
and no writable evidence destination. Model calls use a budgeted broker outside the task sandbox so
the task process does not receive the provider credential. A configuration that requires a provider
credential inside the task sandbox cannot satisfy the isolated profile, cannot access protected
holdouts, and is reported separately as a lower-trust run.

The broker is an explicit, versioned network-policy exception. It exposes a narrow authenticated
model protocol to one trial, a fixed upstream destination, bounded request and response sizes, rate
and cost limits, and no arbitrary URL or tool forwarding. Conformance tests verify that the channel
cannot proxy general traffic, reach other trials, or bypass the trial network policy.

Dependency preparation occurs in the trusted preparation phase from reviewed frozen locks,
integrity-checked artifacts, and pinned tool versions. Canonical dependencies and pinned binaries
are read-only in agent and submission sandboxes, module resolution cannot leave that closure, and
resolution-critical inputs are rehashed before grading. Package installation or lifecycle execution
does not run after agent credentials or writable trusted evidence become available. Eval-only
dependencies remain subject to the repository security-audit policy.

Network access defaults to denied during agent and verifier execution. A required exception uses a
reviewed allowlist or versioned offline snapshot. Enforcement is defined per isolation backend and
tested for DNS, IPv4, IPv6, loopback, Unix sockets, and applicable metadata endpoints. If a requested
policy cannot be enforced, the trial is infrastructure-invalid rather than silently downgraded.

Initial DX tasks are host-only and use controlled native doubles. Actual iOS and Android behavior
continues through the trusted compatibility harness. Untrusted agents do not run on hosts containing
Apple signing credentials, attached physical devices, release credentials, or trusted native
artifacts. If a later task requires native compilation, it uses a dedicated ephemeral macOS agent
runner and transfers a validated patch to a separate untrusted native-build stage. That stage has no
signing, release, cloud, cache-write, or physical-device credentials. Installation and execution of
the resulting app remain untrusted. A trusted comparison controller may supervise a separate
disposable simulator, emulator, or wiped lab-device environment with no accounts, user data,
release credentials, trusted caches, attached peer devices, or unrestricted egress. The controller
accepts only bounded authenticated observations, keeps comparison and evidence signing outside the
execution boundary, and resets both host and device state afterward. If installation requires
signing, preparation uses a task-scoped non-release identity that is isolated from execution and
never exposes production or App Store credentials.

The agent environment is destroyed before verification. The trusted verifier controller and its
nested submission sandbox are disposable and separate from trusted evidence publication. The
controller uses immutable grader inputs and never accepts grader-result files produced by the agent
workspace. Setup failures, provider failures, policy-enforcement failures, and unavailable compute
are infrastructure errors rather than task failures.

Workspace creation, transfer, retention, and deletion validate canonical harness-owned paths and
reject links or unexpected file types. Failed validation stops the run; cleanup never broadens its
target or retries with a stronger destructive primitive.

## Evidence

Every trial records at least:

- task ID and version;
- repository and suite revision;
- agent harness, agent version, model, and relevant reasoning configuration;
- instruction and permitted context identity;
- operating system, architecture, Node, Bun, and dependency-lock identity;
- requested and actually enforced time, turn, token, retry, network, and resource limits;
- start time, duration, exit reason, and infrastructure status;
- transcript and tool events when the harness exposes them;
- final changed-file list and patch;
- each grader's result, rationale, stdout, and stderr; and
- usage and cost when available.

For hosted agents or model providers, evidence also records the provider fingerprint when one is
available, service region or tier, routing metadata exposed by the provider, execution window, and
request parameters. An unexplained provider-side change is treated as a changed instrument or an
explicit limitation, not silently joined to the prior time series.

The trusted verifier controller produces a nonce-bound and run-ID-bound authenticated manifest over
the task, source export, submission, grader bundle, outcome, and evidence digests. The trusted
publisher verifies provenance, expected workflow and job identity, nonce, schema, and hashes before
writing the atomic published manifest. It includes producer phase, completion status, content
hashes, sizes, media types, and redaction status. Every stream, file, archive, event count,
transcript field, patch, and total run payload has a configured bound. Control characters are
encoded for rendering, secrets are redacted before persistence, and truncation is explicit evidence
rather than an apparently complete result. Agent output cannot supply or overwrite either manifest;
failed authentication is an infrastructure error.

Checked-in tasks, schemas, reference solutions, and grader code are reviewed truth. Trial
transcripts, patches, logs, reports, and generated workspaces are disposable artifacts under
`.artifacts/evals` and are not committed.

## Metrics and interpretation

The primary metric is required-gate task success. Reports include:

- literal chronological first-trial success for smoke reporting;
- empirical per-task success frequency across conditionally exchangeable repeated trials;
- `pass@k`, the estimated probability that at least one of `k` attempts succeeds, only where
  multiple attempts are part of the product scenario;
- all-attempt reliability across the `k` observed trials for reliability-sensitive scenarios;
- infrastructure-error rate;
- median and distribution of duration, turns, tokens, and cost; and
- results grouped by suite and capability tag.

Reports define the estimator, sample size, uncertainty interval, independence assumptions, retry
treatment, timeout treatment, infrastructure-error denominator, run ordering, model randomness,
seed support, and paired-comparison policy. Three trials are diagnostic smoke evidence only. They do
not support small-difference or model-ranking claims.

Reports publish both unconditional operational success, where infrastructure errors remain in the
denominator, and conditional task success among valid trials using a frozen failure taxonomy. They
state whether repetitions are credibly exchangeable and describe clustering, provider drift, and
shared-runner effects. `pass@k` is omitted when its assumptions do not hold, and no `p^k` estimate is
derived from dependent attempts.

Aggregate success must not hide a zero or severe regression in a critical capability such as typed
failure handling or resource cleanup. Small score differences are not treated as meaningful unless
the number of trials and infrastructure stability support that interpretation.

Regression and capability views use the same evidence but answer different questions:

- the **regression view** preserves tasks that should continue to pass; and
- the **capability view** includes unsolved but valid tasks that identify the next API or
  documentation improvement.

A saturated task remains useful as a regression guard but no longer measures improvement.

Comparisons are made only across identical task, grader, fixture, documentation, harness, and
resource-policy versions. API or documentation experiments use paired revisions under the same
declared agent configuration with randomized or counterbalanced run ordering where practical.
Changed instruments start a new baseline rather than being spliced into an old time series.

The task bank has three roles:

- **development** tasks may change while improving APIs, documentation, tasks, and graders;
- **regression** tasks and thresholds are frozen for a release line, with explicit quarantine and
  re-entry rules for demonstrated task flakiness; and
- **protected holdout** tasks are periodically refreshed and used only for scoped held-out
  performance claims.

Task provenance, exposure, duplication, and contamination are tracked across these roles. A result
from a public regression task is not presented as contamination-resistant evidence. Holdout secrecy
does not establish representativeness. Any broader generalization claim additionally declares a
target population, sampling frame, task-selection procedure, coverage and weighting scheme, and
uncertainty limits.

## Human baselines

The claim that better-native is easy for humans requires human evidence. A human baseline uses the
same starting fixture, instruction, public documentation bundle, and grader criteria as an agent
trial. Each cohort has an explicit tool, assistance, time, and network policy. Cross-cohort results
are descriptive unless those differences are experimentally controlled.

Each study defines inclusion criteria, Expo and Effect experience strata, recruitment, onboarding,
permitted assistance, stopping and abandonment rules, task-order randomization or counterbalancing,
and treatment of censored completion time. Human sessions record completion, duration, assistance
requested, documentation consulted, points of confusion, and final grader results. Humans and
agents receive separate summaries; turns, tokens, and identical time limits are not treated as
comparable human metrics. A small formative study identifies observed product friction but is not
reported as statistically representative proof.

## Execution policy

Before agent runs are allowed, pull requests validate task schemas, fixtures, negative controls,
reference solutions, deterministic graders, filtered-export manifests, archive rejection cases, and
isolation-backend conformance. This keeps the suite executable without spending model tokens on
every repository change.

Trusted preparation, verifier code, schemas, stable graders, reducers, thresholds, and workflow
policy are loaded by digest from a protected default-branch revision or reviewed release artifact;
the pull-request checkout is only an untrusted source input. A pull request that changes evaluation
infrastructure is shadow-validated, then separately reviewed and re-baselined into a new trusted
revision before that revision can grade its own changes.

Untrusted pull-request code never executes in a job carrying model-provider, GitHub write, OIDC,
signing, deployment, Turbo, or publication credentials. Agent execution, verifier execution, and
evidence publication use separate jobs or runners with minimum permissions. Agent runs are never
triggered through `pull_request_target`. Trusted preparation releases a protected task's
trial-visible instruction and fixture only to its assigned isolated trial. The verifier-only bundle
is mounted only in the trusted controller, and concealed challenges cross into the nested
submission sandbox only through the constrained black-box protocol.

Protected-task policies define maximum reuse, provider data-retention requirements, operator access,
private transcript and stdout retention, result-redaction rules, and retirement. Detailed holdout
evidence remains access-controlled; public evidence is limited to reviewed aggregates and digests
that do not reveal reusable concealed material.

Agent smoke runs are initially manual or scheduled. After baselines are collected and failures are
audited, selected stable tasks may become pull-request gates. Full multi-trial suites run before a
release or when a public API, migration guide, agent harness, or supported model configuration
changes materially.

Thresholds are evidence-based. The repository does not invent a release percentage before it has a
validated baseline, known infrastructure error rate, and reviewed task distribution.

After calibration, thresholds are pre-registered for a versioned regression set and validated on
separate runs. A changed task, grader, fixture, documentation bundle, harness, or resource policy
cannot inherit the old threshold without an explicit re-baseline.

## Initial milestones

### Milestone 0: validate the instrument

The first implementation contains:

- an exact reviewed Vitest Evals dependency that passes the repository security-audit policy and is
  compatible with the pinned Vitest version;
- an Effect-native `tooling/dx-evals` workspace using normal imports from the pinned `effect`
  package, included in typecheck, strict Effect diagnostics, `@effect/vitest` tests, and Knip;
- one process-owned `ManagedRuntime` built from `NodeServices.layer` and the complete application
  Layer, reused by every trial in that process and covered by a disposal test;
- a conformance check rejecting direct imports from `vendor/effect` and recording the installed
  Effect version and pinned source revision;
- one synthetic consumer task with no Expo or native dependency;
- task-schema and filtered-export validation;
- reference and no-op adapters only;
- one isolation backend with conformance tests;
- one clean-room deterministic verifier;
- bounded atomic evidence under `.artifacts/evals`;
- exactly one harness run per Vitest case; and
- both the `vitest-evals/reporter` and Vitest JSON reporter, with the JSON reporter writing to a
  unique bounded `outputFile.json` beneath `.artifacts/evals`; and
- a smoke test that validates the exact JSON artifact and eval metadata, serves that artifact with
  `vitest-evals serve` on an ephemeral port, probes the report UI, and terminates it cleanly.

Milestone 0 must prove that the no-op fails, the reference passes, runtime-withheld material is not
present in the agent export, malicious archives are rejected, timeouts destroy the agent
environment, verification occurs in a fresh environment, and evidence cannot be forged by the
submission.

### Milestone 1: validate a real task

After Milestone 0 passes its security and lifecycle audit, add:

- one Network consumer task using packed public packages and controlled native doubles;
- one real coding-agent adapter;
- collision-proof trial IDs and initially serialized execution;
- three diagnostic trials in a scheduled trusted workflow; and
- the first human blind pilot of the same task.

Battery Stream, fake-Layer, incremental migration, contributor, native-compilation, parallel, and
protected-holdout tasks follow only after the preceding task demonstrates that the new dimension can
be isolated and graded. More tasks are added from the declared capability universe, observed human
or agent failures, new Effect-native concepts, and real user reports—not to inflate a task count.

## References

- [Vitest Evals: Getting Started](https://vitest-evals.sentry.dev/docs)
- [Vitest Evals: Harnesses](https://vitest-evals.sentry.dev/docs/harnesses)
- [Vitest Evals: Custom Harnesses](https://vitest-evals.sentry.dev/docs/harnesses/custom/)
- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Anthropic: Define success criteria and build evaluations](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests)
- [Anthropic: Quantifying infrastructure noise in agentic coding evals](https://www.anthropic.com/engineering/infrastructure-noise)
- [Inspect: Tasks](https://inspect.aisi.org.uk/tasks.html)
- [Inspect: Multiple Scorers](https://inspect.aisi.org.uk/multiple-scorers.html)
- [Inspect: Human Agent](https://inspect.aisi.org.uk/human-agent.html)
- [Harbor: Task Structure](https://www.harborframework.com/docs/tasks)
- [SWE-bench: Evaluation Harness](https://www.swebench.com/SWE-bench/reference/harness/)
- [OpenAI: A shared playbook for trustworthy third-party evaluations](https://openai.com/index/trustworthy-third-party-evaluations-foundations/)
