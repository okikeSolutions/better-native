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

Package-specific task schemas, loading, workspace specifications, verification, and gate mapping
live in task modules under `tooling/dx-evals/src/tasks`. The closed `TaskRegistry` is the only
package-aware dispatch point. Shared task export, public-package packing, declaration seeding,
clean-room materialization, observation-envelope parsing, and trial orchestration operate on the
common task model and do not add package branches. A new package adds its task module and one
reviewed registry entry rather than extending central `tasks/TaskWorkspace`, `security/Verifier`,
and `TrialRunner` switchboards.

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
`Layer`, `NodeServices.layer`, and the Node HTTP client Layer. That runtime owns the
Layer scope, serves every custom-harness invocation in its process, and is disposed exactly once
when the eval process finishes. A trial never constructs or provides the production Layer again.
Services do not read `process.env` or acquire global filesystem and process dependencies
internally. The host composition boundary decodes optional provider credentials with Effect
`Config`, creates one `@effect/ai-openrouter` client Layer, and makes credential presence available
without exposing the secret value. This follows the same `NodeServices` base layer and
host-configuration boundary as the compatibility harness while using `ManagedRuntime` for the
repeated Promise entrypoints required by Vitest Evals.

Cryptographic operations are also runtime services. Package and evidence digests, ephemeral
evidence keys, evidence HMAC-SHA256, temporary evidence names, and isolation container IDs use
`effect/Crypto` from `NodeServices.layer`. The HMAC construction is composed from the service's
SHA-256 primitive and checked against fixed standard vectors. Eval orchestration does not import
`node:crypto` directly.

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
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"

const MainLayer = DxEvalLive.pipe(
  Layer.provideMerge(Layer.merge(NodeServices.layer, NodeHttpClient.layerNodeHttp)),
)

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

    if (outcome.publicEvidence.status === "process-authenticated") {
      setArtifact("evidence-reference", {
        runId: outcome.runId,
        manifestDigest: outcome.publicEvidence.digest,
      })
    }

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

The initial real adapter is `openrouter-coding-agent`. It uses Effect AI from the pinned `effect`
package and the matching `@effect/ai-openrouter` provider directly; Vercel AI SDK is not inserted as
a second model abstraction. One adapter is parameterized by a reviewed `AgentProfile` containing
the exact model, reasoning settings, prompt-cache policy, provider-routing policy, and trial limits.
Changing any of those values changes the evaluated condition. Each profile is expanded into its own
Vitest case and authenticated evidence records the complete resolved profile.

Agent Profile schema version 3 also contains the decoded virtual-workspace limit policy,
compaction policy, and separate compaction reasoning effort. The workspace implementation is the
single owner of the Effect request/result
schemas consumed by the Effect AI toolkit, including literal closed failure alternatives; it does
not duplicate looser TypeScript interfaces beside the tool boundary. Campaign plans print both
policies and authenticated evidence seals them as part of the resolved profile.

The adapter owns a bounded multi-turn loop around `LanguageModel.generateText`. Its Effect AI
`Toolkit` exposes Pi-shaped `ls`, `find`, `grep`, `read`, `edit`, and `write` operations plus
`check_submission` and `submit` over a virtual task workspace. Following Pi's inspection model, `read`
returns at most 2,000 complete lines or 50 KiB and provides a line offset when more remains;
`grep` accepts regex or literal matching and returns at most 100 matches or 50 KiB, with bounded
context and line lengths. `find` is glob-based, `ls` lists one virtual directory, `edit` requires
unique non-overlapping exact matches, and `write` replaces a complete editable file. None can escape
the precomputed read allowlist or declared write set. General `bash` is intentionally replaced by
the bounded `check_submission` operation: the current task class needs compilation, not host shell
access, and private grader execution remains controller-only. `check_submission` compiles the current candidate against the exact packed public
package inside the same rootless-Podman isolation boundary used by verification. It returns bounded,
sanitized TypeScript diagnostics and never mounts private graders, reference patches, or verifier
sources. Runtime-withheld files are absent. Each public package is produced once per managed runtime with
`bun pm pack --ignore-scripts`; its manifest, exported type entrypoints, and reachable relative
declaration graph populate the agent workspace, while the exact same archive is installed for
clean-room verification. Archive type and path checks run before extraction, package exports and
declaration references must resolve within the package, and the agent and verifier retain the same
archive digest. The exact installed `effect` package is mounted read-only for compilation and
execution; its package manifest and top-level public declaration entrypoints are also mirrored into
the virtual agent workspace so agents receive the same public API discoverability as a normal
consumer editor. Effect runtime JavaScript and internal declaration paths are not agent-visible.
Writes are limited to declared submission paths, and tools execute sequentially.
The trusted controller holds the OpenRouter credential and model conversation; submitted code and
clean-room verification remain secretless and network-denied.

Task-visible `task.json` may declare a versioned public compile contract when a requirement is
expressible entirely through exported types. Network version 2 declares that `readNetwork` must have
no remaining Effect service requirements, so `check_submission` can diagnose a missing
`Effect.provide(Network.live)` before private scenario execution. The isolated compiler generates a
bounded type-only assertion from the decoded declaration; it does not load grader inputs or encode
expected scenario values. Network does not require an empty error channel because output-schema
validation legitimately retains `SchemaError` in the reference implementation.

Following Pi's system-prompt construction, the coding loop builds its system message from the tools
actually exposed, concise tool descriptions, immutable workspace boundaries, and proportional
working guidelines. It does not prescribe a declaration-graph traversal before implementation.
Runtime guidance is derived from evidence instead: a successful `edit` or `write` makes the latest
compile result stale, a failed check asks for a correction and another check, and an unchanged
passing candidate asks for `submit`. Transcript-visible completion-reserve messages begin with three
effective provider requests remaining so implementation, compilation, correction, and submission are
not all deferred to the final request. The effective reserve is the smaller of the remaining turn
allowance and a conservative estimate derived from the remaining observed-token allowance, current
provider context, and maximum per-request output. Fake-LanguageModel tests exercise repeated
compilation and stale-check detection without spending provider tokens.

Reviewed profiles use a 64-request emergency circuit breaker rather than a normal turn budget. It
exists only to contain a pathological zero-usage tool loop; the five-minute duration limit, observed
token allowance, observed cost stop, successful submission, or model completion should end ordinary
trials first. This keeps request count from deciding how much work an efficient or inefficient model
is allowed to do while retaining a finite safety boundary. Low request caps remain injectable in
deterministic tests so the circuit-breaker behavior itself stays covered.

The first paid verification of this policy ran Network v2 for 14 requests and passed all five gates.
It stopped on observed tokens at 124,760 total tokens after two compactions and 21 agent tool calls,
well before the 64-request circuit breaker and within the five-minute duration and USD 0.05 campaign
limits. The agent used the two requests beyond the former ceiling to correct its final schema shape;
clean-room verification then accepted the candidate. The recorded provider cost was USD 0.006099696.

Conversation compaction follows the core invariants of [Pi's coding-agent compactor](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts): estimate the
provider context conservatively, retain a bounded recent suffix, cut only at a complete assistant
turn, and carry forward an explicit checkpoint. The evaluated model performs a bounded, tool-free
semantic-summary request which preserves API names, signatures, error tags, diagnostics, paths,
decisions, failed approaches, and next actions. The harness then combines that summary with
deterministic aggregate tool activity, the latest sanitized `check_submission` result, and the
authoritative changed editable-file state. When the prompt estimate crosses 12,000 tokens, older
provider messages are replaced by this checkpoint. The semantic summary is capped at 512 output
tokens, and complete recent turns are retained only while the resulting prompt stays at or below a
9,600-token post-compaction target. That 20% headroom prevents an ordinary next turn from triggering
another compaction immediately. Summary usage and cost are reported separately and included in trial totals. The evidence
transcript is append-only and retains every original tool call and full bounded tool result, so
context economy cannot erase audit data or alter scoring.

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
target or retries with a stronger destructive primitive. The local baseline validates each existing
artifact-path component without following links, creates controller directories with restrictive
modes, and rechecks canonical paths before use. Effect's portable `FileSystem` service does not
expose descriptor-relative `openat`/`O_NOFOLLOW` operations, so a malicious same-UID host process
racing those checks is outside this local baseline's threat model. Trusted CI must give the eval
process an exclusive workspace; cross-tenant or same-UID shared runners require a stronger
artifact-store backend.

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

Pull-request validation never makes model requests. Paid execution has separate commands and four
layers of control:

- every profile limits turns, output tokens per turn, total observed tokens, duration, and an
  `observedCostStopUsd` soft stop checked after each provider response;
- the process-owned campaign budget reserves each trial's reviewed cost allocation before its first
  request and fails before the declared campaign allocation can be exceeded;
- live preflight requires one reusable key dedicated to eval execution, with a finite
  provider-enforced limit no greater than the reviewed global USD 10.00 ceiling and enough remaining
  allowance for every not-yet-reserved trial in the selected campaign;
- the current `checkpoint-5-diagnostic` campaign declares five trials for each of Network, Battery,
  KeepAwake, and SecureStore in one serialized Vitest invocation, uses exact model slugs, disables
  model and provider fallback, and records the actual provider, fingerprint, usage, and cost; and
- `evals plan` prints the complete selected matrix and conservative maximum cost without reading a
  secret or making a provider request.

Prompt caching is a reviewed profile setting. It is initially disabled so the first cross-model
baseline does not mix cache behavior. A later cached condition must be separately identified and
must record cache-read tokens. Provider or agent retries remain zero unless a versioned profile and
analysis policy explicitly introduce them.

Thresholds are evidence-based. The repository does not invent a release percentage before it has a
validated baseline, known infrastructure error rate, and reviewed task distribution.

After calibration, thresholds are pre-registered for a versioned regression set and validated on
separate runs. A changed task, grader, fixture, documentation bundle, harness, or resource policy
cannot inherit the old threshold without an explicit re-baseline.

## Implementation status

“Implemented” below means the checked-in instrument passes deterministic, secretless validation. It
does not mean a paid model baseline, human pilot, discoverability claim, or regression threshold has
already been established. Normative requirements elsewhere in this document may describe later
hardening beyond the current implementation.

### Checkpoints 1 and 2: foundation and synthetic proof — implemented

The current implementation contains:

- an exact reviewed Vitest Evals dependency that passes the repository security-audit policy and is
  compatible with the pinned Vitest version;
- an Effect-native `tooling/dx-evals` workspace using normal imports from the pinned `effect`
  package, included in typecheck, strict Effect diagnostics, `@effect/vitest` tests, and Knip;
- shared scalar refinements centralized in `src/Domain.ts`, built from Effect's `NonEmptyString`,
  `Natural`, `Int`, and `Finite` schemas rather than repeated feature-local filters;
- Effect `Brand` identities for decoded task, run, adapter, transcript, path, and cryptographic
  values, plus exhaustive Effect `Match` dispatch for closed domain alternatives;
- one process-owned `ManagedRuntime` built from `NodeServices.layer` and the complete application
  Layer, reused by every trial in that process and covered by a disposal test;
- a conformance check rejecting direct imports from `vendor/effect` and recording the installed
  Effect version and pinned source revision;
- one synthetic consumer task with no Expo or native dependency;
- task-schema and filtered-export validation;
- reference, no-op, and deliberately broken deterministic adapters;
- one isolation backend with conformance tests;
- task-owned clean-room deterministic verifiers behind one observation-envelope boundary;
- single-use atomic evidence under a link-checked `.artifacts/evals` root;
- exactly one harness run per Vitest case;
- one deterministic `RequiredGateJudge` that records required-gate pass fraction and failed-gate
  rationale as native Vitest Evals score metadata;
- both the `vitest-evals/reporter` and Vitest JSON reporter, with the JSON reporter writing to a
  unique bounded `outputFile.json` beneath `.artifacts/evals`; and
- an `evals smoke` command that runs the secretless suite, Schema-decodes its exact harness metadata,
  starts the Vitest Evals report UI on an ephemeral loopback port, probes it, and closes it.

The deterministic suite proves that the no-op and deliberately broken solutions fail, the reference
passes, exactly one harness invocation occurs per Vitest case, canonical transcript events reach the
report, runtime-withheld material is absent from trial exports, malicious archives are rejected,
package export and declaration graphs cannot be missing or escape the archive, and agent discovery
shares the verifier's packed-package digest. It also proves that timeouts destroy the agent
environment, verification occurs in a fresh environment, and evidence cannot be forged by a
submission. The isolated supervisor uses Effect `NodeWorker` and the
candidate entrypoint uses `NodeWorkerRunner`; grader inputs are delivered to the supervisor through
consumed stdin, and only a controller-nonce-bound worker envelope is accepted. Controlled
native-double state is closure-held rather than stored on `globalThis`.

### Checkpoint 3: Network baseline — implemented

The Network task consumes the packed public `@better-native/network` package against a controlled
`expo-network` double. Its four isolated scenarios cover one-shot Effect execution,
`Network.live` provisioning, schema-validated output, distinct `NetworkUnavailable` handling, and
native rejection or malformed state preserved as `NetworkFailure`. Reference passes; no-op and the
collapsed-error control fail.

### Checkpoint 4: Battery baseline — implemented

The Battery task consumes the packed public `@better-native/battery` package against controlled
`expo-battery` events. Its isolated scenarios cover ordered Stream consumption, Layer activation,
normal completion, early downstream termination, listener cleanup, and listener-registration
failure preserved as `BatteryFailure`. A fixed-value stream may reproduce happy-path values but
still fails lifecycle and provisioning gates.

### Checkpoint 4b: KeepAwake baseline — implemented

The KeepAwake task consumes the packed public `@better-native/keep-awake` package against a
controlled `expo-keep-awake` double. Its isolated scenarios cover Layer provisioning, an explicitly
tagged lease that remains active until interruption, exactly-once scoped cleanup,
`KeepAwakeUnavailable`, and activation failure preserved as `KeepAwakeFailure`. An unscoped lease
may activate correctly but still fails the interruption-cleanup gate.

### Checkpoint 4c: SecureStore baseline — implemented

The SecureStore task consumes the packed public `@better-native/secure-store` package against a
controlled `expo-secure-store` double. Its isolated scenarios cover Layer provisioning, exact key
and option forwarding, write/read round trips, cleanup after success and read failure, and native
read and write failures preserved as `SecureStoreFailure`. Reference passes; no-op and unbracketed
cleanup controls fail their expected gates.

### Checkpoint 5: real execution and reporting — live pilot complete, human evidence pending

The `openrouter-coding-agent`, bounded Effect AI toolkit and multi-turn loop, reviewed five-model
profile registry, fake-LanguageModel tests, serialized execution, per-trial resource limits and
observed-cost stop, campaign budget, provider preflight, usage and cost evidence, and no-request
campaign plan are implemented. `checkpoint-5-smoke` declares one Network trial using the cheapest
compatible profile, DeepSeek V4 Flash 0731, with a USD 0.05 ceiling. It is the paid acceptance check
for a valid provider response, nonzero usage and cost, complete process-authenticated evidence, and
meaningful required-gate diagnostics. Task success remains diagnostic; infrastructure and evidence
validity are mandatory. `checkpoint-5-diagnostic` declares five trials each for Network, Battery,
KeepAwake, and SecureStore. DeepSeek V4 Flash 0731, GPT-5.6 Luna, Grok 4.5, Kimi K3, and Claude
Sonnet 5 run exactly once on each task. The full reviewed ceiling is USD 8.00; any task-only subset
is USD 2.50. Existing paid observations predate the KeepAwake and SecureStore blocks and do not
support model-ranking claims; paid KeepAwake and SecureStore execution remains pending.
The serialized campaign ledger reserves each profile's declared maximum before execution, then
settles a completed trial to its recorded actual provider cost. Provider failures or missing cost
retain the conservative reservation, and the next trial still fails fast if it cannot fit beneath
the campaign-wide ceiling.

The first `checkpoint-5-smoke` execution completed on 2026-08-06. The pinned DeepSeek provider
returned a valid response, the agent submitted after 7 turns and 13 tool calls, and usage recorded
31,526 input tokens, 2,594 output tokens, 34,120 total tokens, and USD 0.001585476 actual cost with no
retry. The canonical transcript contained 30 events, and the report's public evidence digest matched
the persisted HMAC-SHA256 manifest. Infrastructure was valid. The candidate passed the public
package-boundary and output-schema gates but failed the three behavioral scenario gates, producing
sanitized compilation and scenario diagnostics. The 0.40 judge score is diagnostic evidence that
the paid instrument works; it is not a model-performance baseline.

A post-compaction scheduling verification on 2026-08-06 confirmed that the bounded loop now leaves
enough room for correction and submission. After one transient first-response provider failure, the
same pinned endpoint passed the bounded compatibility probe and the retried trial completed with
valid infrastructure. The agent used 12 turns and 18 tool calls, performed a failed compile, edited
the candidate, passed the next compile, and submitted. Compaction occurred once, reducing the
estimated provider context from 13,964 to 9,487 tokens; it did not recur on every remaining request.
The run recorded 100,120 input tokens, 6,351 output tokens, 106,471 total tokens, and USD 0.005122044.
The candidate still scored 0.40 because it omitted `Network.live` provisioning and failed the three
behavioral gates. The report correctly classified this as a task failure with valid infrastructure.

Network version 2 was then run as a controlled follow-up with the same DeepSeek profile and resource
limits. The only task-facing changes were explicit Layer-boundary wording and the agent-visible
no-remaining-services compile contract. The infrastructure-valid run used 12 turns, 21 tool calls,
102,180 total tokens, and USD 0.004549302. `Network.live` was present and the available-state gate
changed from fail to pass. Both public compile checks rejected an export whose inferred service
requirements remained `unknown`. The candidate nevertheless recovered typed errors into snapshot
values and then wrapped those snapshots as `available`, so the unavailable and failure gates still
failed; the loop reached its turn limit before a final compile and submit. The score moved from 0.40
to 0.60. This supports the narrow conclusion that public contract feedback improved Layer adoption;
it does not establish task success or justify weakening the behavioral verifier.

The first live matrix is selected to expose the same public adoption task to meaningfully different
price and capability tiers: DeepSeek is the ultra-cheap open-weight baseline; Luna is the cheap
proprietary baseline; Grok is a cost-efficient frontier coding model; Kimi targets repository
navigation and tool-driven iteration; and Sonnet supplies an Anthropic frontier baseline. Exact
ZDR-compatible provider endpoints are pinned respectively to `deepinfra/fp4`, `azure`, `xai/zdr`,
`moonshotai/mxfp4`, and `amazon-bedrock/global`. All require the requested reasoning and tool
parameters, deny data collection, disable fallbacks, and enforce zero data retention. Prompt caching
is disabled. Claude Opus 5 and GPT-5.6 Sol are intentionally deferred to a separately reviewed
premium-frontier campaign after the live adapter and evidence pipeline have completed this pilot.

Each profile reviews one mutually exclusive OpenRouter output-token parameter. Luna uses
`max_completion_tokens`; DeepSeek, Grok, Kimi, and Sonnet use `max_tokens`. The same selection is
used by model defaults and every remaining-budget clamp, and fake-LanguageModel tests assert that
the unused alias is absent.

DeepSeek provider eligibility has a separate bounded compatibility instrument. It sends one forced
schema-valid tool call with no retry, a 512-token output maximum, a 60-second timeout, one explicit
provider, and fallbacks disabled. Malformed output, a missing tool call, absent usage evidence,
provider failure, or timeout quarantines the provider and never becomes a task score. On 2026-08-06,
`deepinfra/fp4` passed with 306 input tokens, 66 output tokens, and USD 0.000034812 actual cost. The
preserved first campaign remains unchanged and continues to document Morph's malformed response.
The selector now accepts every reviewed profile and exercises the exact Network system prompt,
task prompt, model layer, and coding toolkit for as many as twelve bounded turns. Luna's pinned Azure
endpoint passed that protocol using `max_completion_tokens`, with 8,402 input tokens, 443 output
tokens, and USD 0.0096776 actual cost. The probe identified explicit `null` values for omitted
inspection-tool arguments; the schemas now treat those values as omission while handlers retain
their integer, path, and output limits. A subsequent profile-filtered Luna Network trial was
infrastructure-valid, produced process-authenticated evidence, used 121,107 observed tokens, and
cost USD 0.0785156. Its 0.80 score and token-limit exit are retained as an unbiased task failure,
not a provider failure. Luna is therefore no longer compatibility-quarantined; all historical
attempts remain unchanged in the blind baseline. `evals plan` and `evals run` accept an explicit
`--profile` filter so provider debugging cannot accidentally execute the rest of the matrix.

Profile-filtered verification then resolved the remaining reviewed providers independently. Grok
passed all five Network gates after 5 turns and 11 tool calls; Kimi passed all six Battery gates
after 15 turns and 18 tool calls; and Sonnet passed all five Network gates after 10 turns and 17
tool calls. Sonnet's first Battery retry failed before task scoring because it supplied the widely
used single-edit payload `{ path, oldText, newText }` while the harness exposed only the batch form
`{ path, edits }`. The root tool schema cannot use `anyOf` under the OpenAI-compatible codec, so one
object schema now accepts either shape and the Effect handler normalizes both into the existing
bounded uniqueness, overlap, allowlist, and file-size checks. The next isolated Sonnet Battery run
submitted after 9 turns and 9 tool calls, recorded 53,307 tokens and USD 0.11347, and passed all six
gates with valid authenticated evidence. This was a harness compatibility fix; no provider fallback
or automatic agent retry was introduced, and failed historical attempts remain preserved.

The first report score is deterministic. `RequiredGateJudge` projects the trusted verifier's
required gates into a score from zero to one and includes failed gate identifiers and rationales.
Reference controls enforce a score of one. Expected-negative controls and the uncalibrated first
live campaign use a null threshold, which records scores without making diagnostic task failure a
Vitest infrastructure failure. No initial LLM judge is used because every current criterion is
executable; a model-backed rubric remains reserved for a future criterion that cannot be checked
deterministically and survives calibration against human labels.

Reporter-facing results keep three independent dimensions. Vitest assertion execution is
`completed`, `failed`, `skipped`, or `unknown`; infrastructure is `valid`, `error`, or unavailable;
and the task is `success`, `failure`, or `not-evaluated`. The judge score remains a separate numeric
projection. Consequently a diagnostic assertion that completed with score 0.20 is reported as a
task failure, never as a passed task. Infrastructure errors are excluded from the conditional task
denominator rather than converted into a scoreable task failure.

Public failure evidence uses only the frozen sanitized categories `compilation`, `module-load`,
`provider-protocol`, `timeout`, `scenario`, `source-policy`, and `harness`, plus its trusted phase and
optional gate ID. Compiler text, submitted source, provider bodies, exceptions, and private grader
values remain outside this evidence. This makes failed gates diagnosable without widening the
agent-visible or report-visible trust boundary.

Operational diagnostics use Effect logging with scoped campaign and trial annotations plus timed
spans. They record lifecycle, bounded budget, sandbox exit, cleanup, and evidence-publication state.
Console logs, traces, reports, and public evidence never contain task instructions, model responses,
submitted source, provider bodies, credentials, controller nonces, or authentication key material.
For live campaigns, Effect's native `Logger.formatJson` and `Logger.toFile` also write a private
`diagnostics.jsonl` in the collision-proof campaign artifact directory. Provider-failure entries
retain the semantic Effect AI error, HTTP status, selected non-secret response headers, and at most
64 KiB of response body, with explicit byte counts and truncation. They exclude request bodies,
prompts, tool arguments, and submissions; are mode 0600; reject linked sink paths; remain outside
Vitest metadata and authenticated public evidence; and flush when the managed runtime is disposed.
Canonical transcripts and evidence remain the trial-result authority.

The first complete five-profile Network-and-Battery campaign on 2026-08-06 produced nine
infrastructure-valid task successes and one unscored Grok Battery provider-protocol failure. The
new private diagnostic sink reproduced and identified that failure exactly: the pinned Grok endpoint
requires reasoning on every request, while the semantic compaction request had explicitly disabled
reasoning. Agent profile schema version 3 therefore declares a separate reviewed
`compactionReasoningEffort`; Grok uses its already-compatible `medium` effort and the other four
profiles retain `none`. A fake-LanguageModel regression proves that the compaction override is sent.
The subsequent isolated Grok Battery run did not compact, but completed with valid infrastructure,
submitted after 8 turns, used 64,502 tokens and 14 tool calls, cost USD 0.0430392, and passed all six
gates. The failed full-campaign observation remains unchanged and unscored; no automatic retry or
provider fallback was introduced.

After reducing the reviewed campaign ceiling to USD 4.00, the first rerun exposed that the
in-process ledger retained every completed trial's worst-case reservation. Eight trials executed,
then Kimi and Sonnet Battery were rejected before provider access because the accumulated
reservations reached USD 3.45. The ledger now atomically settles a completed serialized trial to its
recorded actual provider cost; provider failures or missing cost retain the conservative
reservation. Budget tests cover this behavior, and the failed run remains available as
infrastructure evidence rather than task evidence.

The corrected complete campaign then scheduled all ten trials and recorded USD 0.564131394 across
the nine trials with usage evidence. Nine trials were infrastructure-valid: seven passed every
required task gate, while DeepSeek and Luna Network produced valid task failures. DeepSeek Battery
received an OpenRouter `RateLimitError` before task verification and remains an unscored
infrastructure failure. No automatic retry or provider fallback was used. This validates the
campaign budget, reporting, evidence, and multi-provider execution path, but the strict requirement
that every live trial be infrastructure-valid remains unmet and no model success-rate threshold is
derived from this pilot.

One Effect `Command` entrypoint exposes `validate`, `smoke`, `plan`, `run`, `probe-provider`, and
`report`. A paid run summarizes its exact collision-proof report after Vitest exits and keeps test
execution, infrastructure validity, task success, and judge score separate. `report` resolves exact
regular report files: the default and `--latest` serve only the newest retained run,
`--campaign <id>` serves that campaign's runs, and `--all` is required to aggregate history. Package
selection is a reviewed campaign/task option rather than a growing collection of package scripts.
The manually dispatched `paid-evals` GitHub environment runs this same CLI with non-cancelling
concurrency and uploads JSON reports plus process-authenticated evidence. It is not triggered by pull
requests and performs no automatic agent retry.

Reviewed profile literals are runtime-decoded with Effect Schema, including a non-empty provider
allowlist. Each request clamps output to the remaining per-trial output-token budget; aggregate
input-plus-output tokens and actual provider cost are observed stop thresholds. One reusable
dedicated OpenRouter key has a reviewed finite USD 10.00 server limit bounding total eval-key
exposure. The selected campaign has a separate fail-fast reservation budget. The
`observedCostStopUsd` profile field is intentionally named as a soft, post-response stop because one
response can cross it. A `submit` tool call does not bypass token, cost, or missing-cost checks, and
duplicate paid run IDs are rejected.

Current evidence is labeled `process-authenticated`: its HMAC key is ephemeral to one managed
runtime. It binds the canonical task instruction, selected adapter/profile, private evaluator code
and grader-data digest—including controlled native doubles and runtime configuration—sandbox image
and policy, submission, observations, gates, usage, and exit reason. Durable cross-process
publication remains the separate publisher milestone described by the normative Evidence section;
this baseline does not mislabel its local HMAC as that facility.

The first paid live campaign is preserved byte-for-byte under `evals/baselines/` as a historical
blind diagnostic. It is not an accepted performance baseline: four provider attempts failed at the
infrastructure boundary and none of the six infrastructure-valid trials passed every required task
gate. Network and Battery now have later paid pilot evidence, while KeepAwake and SecureStore have
deterministic coverage but no paid campaign results yet. Until every current task has valid blind
evidence and the infrastructure has survived repeated real-adapter runs, there is no model
success-rate claim and no pull-request threshold derived from agent performance.

### Next evidence milestones — pending

- run the first human blind pilots using the same trial-visible public boundary;
- manually dispatch and audit the reviewed Checkpoint 5 diagnostic campaign after those pilots;
- version and expose the intended generated-reference and handwritten-guide bundle before using
  these tasks to support documentation-discoverability claims;
- define pre-registered regression thresholds only after baseline and infrastructure-noise review;
- add fake-Layer, incremental-migration, contributor, native-compilation, parallel, and protected
  holdout tasks only when each adds a distinct measurable dimension; and
- enable branch protection after the secretless deterministic suite is established as the required
  pull-request check.

More tasks are added from the declared capability universe, observed human or agent failures, new
Effect-native concepts, and real user reports—not to inflate a task count.

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
