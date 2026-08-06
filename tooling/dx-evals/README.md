# Developer-experience eval harness

This private workspace owns the Effect-native runner behind better-native's Vitest Evals custom
harness. It is not included in consumer task exports.

The root `bun run test:coverage` command includes the complete `src` controller and the in-process
compile-diagnostic sanitizer as dedicated coverage threshold groups. Podman and Node-worker
entrypoints are validated by the isolation and protocol suites but excluded from parent-process V8
coverage, which cannot observe their execution without a separate coverage transport.

The executable boundary builds one `ManagedRuntime` from `NodeServices.layer` and the application
Layers. Vitest Evals calls that runtime through `createHarness()` and receives only normalized,
JSON-safe outcomes and transcript events.

## Current status

The foundation, synthetic proof, Network baseline, and Battery baseline are implemented and pass
secretless validation. The reviewed `checkpoint-5-smoke` campaign selects one Network trial with
the cheapest compatible profile before the larger `checkpoint-5-diagnostic` campaign runs five
pinned profiles once on Network and once on Battery. The first diagnostic campaign is preserved
unchanged under `evals/baselines/`; it is not an accepted performance baseline. Human blind pilots,
calibrated thresholds, and model success-rate claims remain pending.

The synthetic foundation, Network, and Battery tasks provide:

- versioned trial, gate, transcript, usage, and evidence schemas with Effect-branded identities,
  validated paths, and cryptographic values;
- reference, no-op, and deliberately broken adapters;
- one profile-driven `openrouter-coding-agent` using Effect AI and `@effect/ai-openrouter` directly;
- a managed runtime with idempotent disposal;
- a custom-harness normalization boundary;
- filtered task exports and strict changed-file submission validation;
- clean-room reconstruction and rootless Podman execution as UID 65532 with no network, a read-only
  root, private PID/IPC namespaces, dropped capabilities, bounded resources, and a pinned image;
- Effect `NodeWorker`/`NodeWorkerRunner` candidate isolation inside the sandbox, with results bound
  to a controller nonce absent from argv, environment variables, and candidate-owned global state;
- one process-scoped, validated `bun pm pack --ignore-scripts` artifact per public package, shared
  by agent API discovery and clean-room verification;
- the exact installed Effect package mounted read-only for clean-room execution, with its manifest
  and top-level public declaration entrypoints mirrored into the agent workspace for normal API
  discovery;
- a Pi-style coding surface: bounded `ls`, glob `find`, regex-or-literal `grep`, paged `read`,
  unique exact-replacement `edit`, and full-file `write`; grep returns at most 100 matches/50 KiB
  while read returns at most 2,000 complete lines/50 KiB and an offset for continuation;
- a bounded `check_submission` compiler that returns sanitized public diagnostics from the same
  rootless-Podman boundary without mounting private graders or reference material;
- syntax-aware public-package import policy plus native doubles nested below the packed package;
- controller-side comparison and atomically persisted, single-use process-authenticated evidence;
- a deterministic `RequiredGateJudge` that projects trusted gate outcomes and rationales into
  first-class Vitest Evals scores without making another model call;
- sanitized compilation, module-load, provider-protocol, timeout, scenario, source-policy, and
  harness failure evidence, separated from private diagnostics and grader material;
- campaign summaries that independently report test execution, infrastructure validity, task
  success, and judge score; a completed 0.20-scored trial is never described as a passing task;
- Effect-native lifecycle diagnostics with safe campaign/trial annotations and timed spans, plus a
  private native `Logger.formatJson` / `Logger.toFile` JSONL sink per live campaign; and
- a deterministic smoke suite whose canonical transcript events reach the configured JSON report.

Console diagnostics, public evidence, and reports never include task instructions, model responses,
submitted source, provider bodies, credentials, controller nonces, or evidence-authentication key
material. User-facing CLI JSON stays on Effect `Console`; operational lifecycle events use
`Effect.log*`. Live campaign runtimes additionally write `diagnostics.jsonl` beneath the exact
campaign artifact directory using Effect's native JSON formatter and file logger. That private
0600 file contains ordinary lifecycle events and, for provider failures only, a maximum 64 KiB
response body, semantic Effect AI error fields, selected non-secret response headers, and HTTP
status. It never records the provider request body, prompt, tool arguments, submission, or
credentials. Private diagnostic events are filtered from both console and tracer loggers. The
managed-runtime scope flushes pending JSONL entries on disposal, and linked diagnostic files are
rejected before opening.

Filesystem, process, and cryptographic capabilities all come from the process-owned Effect runtime.
Package digests, evidence SHA-256, HMAC-SHA256, secure evidence keys, temporary evidence names, and
container IDs use `effect/Crypto` backed by `NodeServices.layer`; `dx-evals` has no direct
`node:crypto` imports.

The Network task builds and packs `@better-native/network`, extracts only that public artifact
into the clean-room workspace, and supplies a controlled `expo-network` double. Four isolated
scenarios verify a one-shot native read, `Network.live` provisioning, a restrictive exported
Schema, distinct `NetworkUnavailable` and `NetworkFailure` outcomes, and malformed native payload
handling. Package source, reference patches, grader data, and the controlled runner remain outside
the task export.

The Battery task similarly packs `@better-native/battery` and supplies a controlled
`expo-battery` double. Its isolated scenarios verify ordered Stream events, Layer activation,
cleanup after normal completion and early downstream termination, and preservation of a native
listener-registration failure as `BatteryFailure`. A fixed-value stream can match the happy-path
values but still fails the lifecycle and provisioning gates.

Paid Network and Battery trials are opt-in. A reviewed campaign registry expands the same coding
harness across exact model configurations, disables automatic fallbacks, orders Network before
Battery, reserves the full per-trial cost allocation, and records tokens, turns, cost, serving
provider, and fingerprint. Fake-LanguageModel tests exercise the actual Effect AI toolkit and
bounded multi-turn loop without network access. Following Pi's construction, the system prompt lists
the tools actually exposed and keeps exploration proportional instead of requiring a declaration
graph traversal before editing. Runtime guidance tracks whether the candidate changed after its
latest `check_submission`, asks for another check when compilation is stale, asks for fixes after a
failed check, and requests submission after an unchanged passing check. A three-request completion
reserve starts before the final request. Dependency declarations remain read-only and Effect
internals/runtime JavaScript stay outside the agent file surface.

The virtual workspace owns the Effect `Schema` definitions used for every `ls`, `find`, `read`,
`grep`, and `edit` request and result; the Effect AI toolkit imports those schemas directly. Closed
failure reasons are literal schema alternatives rather than arbitrary strings. Its decoded limit
policy and the decoded compaction policy are part of reviewed Agent Profile schema version 3, appear
in the dry-run plan, and are sealed into live evidence with the resolved profile.
Shared scalar refinements—including non-empty strings, positive integers, non-negative integers,
and positive finite numbers—are defined once in `src/Domain.ts`; feature modules compose those
schemas instead of recreating local filters. The separately mounted runner protocol uses Effect's
built-in `Schema.NonEmptyString` directly so it does not need an application-source mount.

Network task version 2 declares an agent-visible public compile contract in `task.json`:
`readNetwork` must have no remaining Effect service requirements. `check_submission` enforces that
type-level contract inside its isolated compiler without loading or exposing scenario graders. It
deliberately does not require an empty error channel because the reference solution's schema
validation retains `SchemaError`.

Provider-facing conversation context is compacted independently from evidence. Once the estimated
prompt exceeds 12,000 tokens (a 20,000-token working budget minus an 8,000-token response reserve),
the loop asks the evaluated model for a bounded, tool-free semantic summary of older turns and
combines it with deterministic tool activity, the latest public compilation result, and a bounded
snapshot of changed editable files. The summary is capped at 512 output tokens. It initially selects
up to 8,000 tokens of complete recent assistant/tool turns, then removes the oldest complete turns
until the resulting prompt is at or below 9,600 tokens. This leaves 20% headroom below the trigger
and never cuts between a tool call and its result. Summary tokens and cost are reported
separately while remaining included in trial totals. The canonical transcript remains complete.
This follows [Pi's context-compaction shape](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts); using the evaluated model keeps the summary behavior part of the declared agent profile.

Completion guidance uses both remaining turns and a conservative billed-token estimate. It starts
the implement → compile → fix → submit reserve when either budget reaches the corresponding
three-request window, rather than assuming that every model consumes context equally efficiently.

### Paid smoke trial

`checkpoint-5-smoke` is the first paid acceptance check for the provider, coding loop, verifier,
usage accounting, evidence, and report path. It contains exactly one serialized Network trial using
`deepseek-v4-flash-0731`, pinned to the previously probed `deepinfra/fp4` provider, with a USD 0.05
campaign ceiling.

Review the no-request plan before enabling the credentialed run:

```sh
bun run evals plan --campaign checkpoint-5-smoke
bun run evals run --campaign checkpoint-5-smoke --confirm-paid
```

The run uses the reusable dedicated eval key. Its finite server-side limit must be no greater than
the reviewed global USD 8.00 ceiling, and its remaining allowance must cover the selected USD 0.05
campaign allocation. Acceptance requires valid infrastructure, nonzero input/output/total tokens
and actual cost, at least one required gate with a non-empty rationale, a canonical transcript, and
process-authenticated public evidence. Task success is diagnostic at this stage; infrastructure and
evidence validity are mandatory.

The first smoke run completed on 2026-08-06 with valid infrastructure and
process-authenticated evidence. DeepSeek submitted after 7 turns and 13 tool calls, using 31,526
input tokens, 2,594 output tokens, 34,120 total tokens, and USD 0.001585476. It passed the public
package-boundary and output-schema gates, then failed the available, unavailable, and failure
scenario gates; the report recorded compilation and scenario diagnostics without misclassifying
them as infrastructure failure. This validates the paid execution and evidence path, not task
quality or model performance.

The post-compaction scheduling verification on 2026-08-06 completed with valid infrastructure after
one transient first-response provider failure and a successful bounded compatibility probe. The
agent used all 12 turns, compiled, corrected both public TypeScript diagnostics, recompiled
successfully, and submitted. Context compacted exactly once from an estimated 13,964 to 9,487
tokens. The run recorded 100,120 input tokens, 6,351 output tokens, 106,471 total tokens, and USD
0.005122044. It again scored 0.40: the final candidate passed package-boundary and schema gates but
failed all three behavioral gates because it left `Network.live` unprovided. This is a valid model
task failure, not a harness or provider failure.

The first Network v2 experiment then held the same DeepSeek profile and limits constant while
clarifying the Layer boundary and enabling the public compile contract. It completed with valid
infrastructure after 12 turns and 21 tool calls, using 102,180 total tokens and USD 0.004549302. The
agent provided `Network.live`, and the available-state gate changed from fail to pass. Both compile
checks correctly rejected an export whose inferred requirements remained `unknown`. The final
candidate still failed the unavailable and failure gates because it recovered errors into snapshot
values and then wrapped those values again as `available`; it also reached the turn limit before a
final check and submit. The score improved from 0.40 to 0.60, demonstrating a targeted harness
improvement rather than a complete task fix.

Current reviewed profiles no longer treat 12 provider requests as a working budget. They use a
64-request emergency circuit breaker; duration, observed tokens, observed cost, submission, and
model completion are the normal stopping conditions. Completion-reserve guidance still uses the
smaller effective remaining capacity, so an approaching token boundary prompts compilation and
submission without prematurely constraining models that need more short requests.

The paid comparison run validated that change on 2026-08-06. With the same Network v2 task and
DeepSeek profile, the agent continued to 14 requests, corrected its candidate after two sanitized
compile failures, and passed all five required gates. The run stopped on the 120,000 observed-token
threshold after recording 124,760 tokens, 21 agent tool calls, two compactions, and USD 0.006099696;
it did not reach the 64-request circuit breaker. This is valid infrastructure and a successful task
result, and it isolates the old 12-request ceiling as a material source of truncation.

### First live model matrix

The first live campaign deliberately spans price, provider, and model-family differences. Every
profile runs once on each task so a model is never confounded with only Network or only Battery.

| Profile                  | Pinned model                      | Pinned ZDR provider     | Token parameter         | Role                               | Observed stop per trial |
| ------------------------ | --------------------------------- | ----------------------- | ----------------------- | ---------------------------------- | ----------------------: |
| `deepseek-v4-flash-0731` | `deepseek/deepseek-v4-flash-0731` | `deepinfra/fp4`         | `max_tokens`            | Ultra-cheap open-weight baseline   |                USD 0.05 |
| `gpt-5.6-luna`           | `openai/gpt-5.6-luna`             | `azure`                 | `max_completion_tokens` | Cheap proprietary baseline         |                USD 0.40 |
| `grok-4.5`               | `x-ai/grok-4.5`                   | `xai/zdr`               | `max_tokens`            | Cost-efficient frontier coding     |                USD 0.50 |
| `kimi-k3`                | `moonshotai/kimi-k3`              | `moonshotai/mxfp4`      | `max_tokens`            | Repository and tool-use specialist |                USD 0.90 |
| `claude-sonnet-5`        | `anthropic/claude-sonnet-5`       | `amazon-bedrock/global` | `max_tokens`            | Anthropic frontier baseline        |                USD 0.65 |

All selected endpoints advertise reasoning and the bounded tool-calling parameters used by the
adapter under zero-data-retention routing. Provider and model fallback remain disabled. The stops
reserve USD 2.50 for either task subset. The complete ten-trial campaign has a tighter explicit USD
4.00 campaign-wide ceiling. They are conservative post-response controls, not price forecasts; the
first run's actual usage and cost are
recorded as evidence. Prompt caching is disabled for this baseline.

Token-limit aliases are reviewed profile data and are mutually exclusive on every request. The
DeepSeek profile moved from the historically malformed Morph endpoint to `deepinfra/fp4` after a
bounded, non-retrying compatibility probe produced the required decoded tool call with 306 input
tokens, 66 output tokens, and USD 0.000034812 actual cost. Re-run the explicit check with
`bun run evals probe-provider --profile deepseek-v4-flash-0731 --confirm-paid`; malformed,
incomplete, or timed-out output quarantines the provider outside task scoring.
The same reviewed probe selector covers every live profile. On 2026-08-06, Luna's pinned Azure
endpoint passed the exact four-turn Network coding protocol with `max_completion_tokens`, 8,402
input tokens, 443 output tokens, and USD 0.0096776 actual cost. The probe exposed that Azure may
serialize omitted inspection arguments as explicit `null`; the tool boundary now treats those
values as omission while preserving bounded handler validation. A subsequent isolated Luna Network
trial was infrastructure-valid with authenticated evidence and USD 0.0785156 actual cost. It hit
the 120,000 observed-token stop after 19 turns and scored 0.80, which is an unbiased task failure,
not a provider quarantine. Historical baseline reports remain unchanged.

The remaining pinned endpoints were then debugged one at a time with profile-filtered trials.
Grok completed Network with valid infrastructure and all five gates after 5 turns and 11 tool calls.
Kimi completed Battery with valid infrastructure and all six gates after 15 turns and 18 tool calls.
Sonnet completed Network after 10 turns and 17 tool calls. Its first Battery attempt exposed a
provider-compatible tool-boundary mismatch: the model emitted the common single-edit object while
the harness only accepted an edit array. The `edit` tool now accepts and normalizes both shapes into
the same bounded exact-replacement implementation. The isolated Sonnet Battery verification then
submitted after 9 turns and 9 tool calls, used 53,307 tokens at USD 0.11347, and passed all six
gates. No provider fallback or automatic retry was added, and historical reports are unchanged.

The required-gate judge is blocking at score `1` for reference controls. Expected no-op and broken
controls, and the first uncalibrated live campaign, record the score with no threshold so the report
shows partial credit and failed-gate rationale without confusing task failure with infrastructure
failure. No LLM judge is used: Network and Battery are fully determined by isolated executable
checks, and adding a grading model would add cost, variance, and correlated model bias without
covering a currently unmeasurable criterion.

Claude Opus 5 and GPT-5.6 Sol are deferred to a separately reviewed premium-frontier campaign. This
keeps the first live run useful for validating the adapter and comparing cost tiers without paying
flagship rates while the live evidence path is still being piloted.

Per-request output is clamped to the remaining output-token allowance. Total tokens and provider
cost are necessarily observed after each response. `observedCostStopUsd` is therefore a soft stop
that prevents another request after the observed threshold; one response can cross it. The reusable
dedicated OpenRouter key's reviewed USD 8.00 server limit bounds total eval-key exposure rather than
one campaign's exact spend. Missing actual cost evidence fails the trial, including when the model
has already called `submit`.

Evidence HMAC keys are intentionally ephemeral and process-scoped in this baseline. The persisted
manifest binds the canonical instruction, adapter and profile, private evaluator-bundle digest,
including controlled native doubles and runtime configuration, submission, observations, gates,
usage, exit reason, and isolation policy. It is not yet a durable
cross-process publication signature; that requires the later publisher described in the contract.

`OPENROUTER_API_KEY` is one reusable key dedicated to eval execution, with a finite server-side
spending limit no greater than the reviewed global USD 8.00 ceiling. Live preflight reads current-key
metadata and rejects unlimited or broader keys, then requires `limit_remaining` to cover the exact
selected campaign allocation. The complete diagnostic campaign allocation is USD 4.00; a
single-task diagnostic subset is USD 2.50; the smoke allocation is USD 0.05. The in-process campaign
budget rejects reservations beyond the selected allocation before another trial starts. Because
execution is serialized, each completed trial's worst-case reservation is atomically settled to its
recorded actual provider cost. A failed call or missing cost keeps the conservative reservation.

The source layout follows the same concern-oriented structure as the compatibility harness:

| Directory         | Responsibility                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `src/agent`       | Model profiles, adapters, the bounded coding loop, public compile tool, and provider compatibility. |
| `src/agent/tools` | Effect AI tool schemas, handlers, and bounded virtual-workspace operations.                         |
| `src/campaign`    | Reviewed trial matrices, campaign budget enforcement, and collision-proof run identities.           |
| `src/evidence`    | Safe artifact paths and authenticated evidence persistence.                                         |
| `src/reporting`   | Judges, campaign summaries, report selection, and report UI smoke verification.                     |
| `src/security`    | Submission validation, rootless isolation, and authenticated observation parsing.                   |
| `src/tasks`       | Task registry, task-owned verification, package artifacts, and workspace materialization.           |

Only composition-level modules remain at `src/`: CLI commands, configuration, shared domain
schemas, custom-harness integration, the managed runtime, and generic trial orchestration. Tests are
co-located with the concern they cover; the isolated candidate runner remains separately rooted at
`runner/` because it executes inside the sandbox rather than the controller runtime.

Control-flow over closed domain alternatives uses Effect `Match` and terminates with
`Match.exhaustive`. `Match.orElse` is reserved for intentionally open external inputs, unknown
causes, or an explicit no-decision fallback. Raw external values acquire brands only after Schema
decoding or explicit validation.

Task-specific schemas, bundle loading, workspace specifications, verification, and gates live in
`src/tasks/<Task>.ts`. `TaskRegistry.ts` is the only closed dispatch point. Shared package packing,
archive and export validation, and public declaration discovery live in
`tasks/PackageArtifact.ts`. Task export, agent seeding, and clean-room materialization consume that
artifact through `tasks/Workspace.ts`; `tasks/TaskWorkspace.ts`, `security/Verifier.ts`, and the
top-level `TrialRunner.ts` contain no Network- or Battery-specific branches.

## Adding a task

1. Add `evals/tasks/<task-id>/instruction.md`, `task.json`, the pristine fixture, declarative grader
   data, a passing `reference.patch`, and a targeted `broken.patch`.
2. Add `src/tasks/<Task>.ts` with Schema-decoded task metadata, one reviewed packed-package
   specification when needed, clean-room observation decoding, and required/diagnostic gate
   mapping. Agent-visible declarations are derived from the validated package archive rather than
   listed separately.
3. Register exactly one task entry in `src/tasks/TaskRegistry.ts`; do not add package switches to
   `tasks/TaskWorkspace.ts`, `security/Verifier.ts`, or `TrialRunner.ts`.
4. Add controlled native doubles only when the public package requires them, and bind every double,
   runner, expected-data file, and task module into the evaluator bundle digest.
5. Add deterministic Vitest Evals cases proving reference passes, no-op fails, and the broken control
   fails the intended gate. Add malformed-source and resource-lifecycle coverage where applicable.
6. Add reviewed real-agent entries to `src/campaign/Campaigns.ts` and verify `bun run evals plan` shows the
   intended ordering, count, and maximum cost. Do not execute those paid entries until the task
   passes its blind pilot.
7. Run `bun run evals validate`, `bun run evals smoke`, typecheck, strict Effect diagnostics, lint,
   formatting, Knip, and the dependency security audit before review.

The trusted setup phase must install rootless Podman and pre-pull the pinned multi-platform image.
Trial execution uses `--pull never` and does not grant network access to submitted code:

```sh
podman pull docker.io/library/node@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd
```

`evals smoke` runs the secretless deterministic suite, Schema-decodes its Vitest JSON and harness
metadata, starts the Vitest Evals report UI on an ephemeral loopback port, probes it, and closes it.
Use `evals report` when you want to keep the report UI open for manual inspection. It serves only
the latest retained report by default. `--campaign <id>` selects one campaign's retained runs and
`--all` explicitly includes historical reports; these scope flags are mutually exclusive.

From the repository root:

```sh
bun run evals validate
bun run evals smoke
bun run evals plan
# Restrict planning or execution to one reviewed provider while debugging.
bun run evals plan --task network --profile gpt-5.6-luna
# Paid and credentialed; the CLI prints the reviewed plan again before execution.
bun run evals run --confirm-paid
bun run evals run --task network --profile gpt-5.6-luna --confirm-paid
# Latest only (also available explicitly as `evals report --latest`).
bun run evals report
bun run evals report --campaign checkpoint-5-diagnostic
bun run evals report --all
```

The full evaluation and trust-boundary contract is in [`docs/evals.md`](../../docs/evals.md).
