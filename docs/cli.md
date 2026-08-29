# Better Native CLI and installation proposal

## Status

This document defines the initial public installation CLI implemented by the `packages/cli`
workspace. The existing scoped `@better-native/<capability>` packages remain the runtime package
model; the CLI coordinates their installation and does not consolidate or replace them. The first
release remains an alpha until its real npm package and trusted-publisher configuration are
bootstrapped.

## Purpose

The proposal publishes a Node-only CLI package named `better-native`. It provides the
`better-native` executable and exposes no mobile capability APIs. Effect-native application APIs
remain in independently versioned packages such as `@better-native/network` and
`@better-native/keep-awake`.

Better Native does not replace Expo's native modules. Each scoped Better Native package adds an
Effect-native JavaScript layer over its Expo capability provider. Expo remains responsible for
selecting native-module versions compatible with the application's Expo SDK; the Better Native CLI
is responsible for selecting and validating the matching scoped package and Effect versions.

The CLI coordinates those two compatibility boundaries. It delegates one exact package plan to the
project-local Expo CLI rather than duplicating Expo's version-selection behavior or performing a
second package-manager mutation. Expo versions packages it knows for the installed SDK and passes
unknown exact package specifications through unchanged.

## Package model

The unscoped package is the CLI only:

| Package                       | Responsibility                       | Application runtime dependency                           |
| ----------------------------- | ------------------------------------ | -------------------------------------------------------- |
| `better-native`               | Node installer and doctor executable | No, unless pinned explicitly as a development dependency |
| `@better-native/network`      | Effect-native Network API            | Yes, when Network is selected                            |
| `@better-native/battery`      | Effect-native Battery API            | Yes, when Battery is selected                            |
| `@better-native/clipboard`    | Effect-native Clipboard API          | Yes, when Clipboard is selected                          |
| `@better-native/keep-awake`   | Effect-native Keep Awake API         | Yes, when Keep Awake is selected                         |
| `@better-native/secure-store` | Effect-native Secure Store API       | Yes, when Secure Store is selected                       |

Applications import the scoped capability packages directly:

```ts
import { Network } from "@better-native/network"
import { Battery } from "@better-native/battery"
import { Clipboard } from "@better-native/clipboard"
import { KeepAwake } from "@better-native/keep-awake"
import { SecureStore } from "@better-native/secure-store"
```

Expo-compatible boundaries remain subpaths of those packages:

```ts
import * as Network from "@better-native/network/expo"
```

The CLI has no dependency on the scoped capability packages and is not imported by them. Its npm
archive contains only Node CLI code and release metadata. Each capability archive contains only its
own runtime boundary. Metro bundle tests must prove that importing one scoped capability cannot
reach another capability, the CLI, or Node built-ins.

Running `npx better-native@alpha` does not add the CLI to the application's `package.json`. A team may pin
`better-native` explicitly as a development dependency when it wants a repository-owned CLI
version, but that is separate from installing a mobile capability.

## Native-provider contract

Each Better Native capability has an Expo native capability provider:

| Better Native package         | Expo provider       |
| ----------------------------- | ------------------- |
| `@better-native/network`      | `expo-network`      |
| `@better-native/battery`      | `expo-battery`      |
| `@better-native/clipboard`    | `expo-clipboard`    |
| `@better-native/keep-awake`   | `expo-keep-awake`   |
| `@better-native/secure-store` | `expo-secure-store` |

The command surface must not imply equal implementation maturity. At the time of this proposal,
reviewed ownership is:

| Capability     | Ownership status | Installation presentation     |
| -------------- | ---------------- | ----------------------------- |
| `keep-awake`   | `effect`         | Supported prototype candidate |
| `network`      | `effect`         | Supported prototype candidate |
| `battery`      | `effect`         | Supported prototype candidate |
| `clipboard`    | `effect`         | Supported prototype candidate |
| `secure-store` | `effect`         | Supported prototype candidate |

This table is generated from reviewed compatibility truth for the published artifact. Help,
installation plans, and `doctor` output expose the same status and evidence boundary. A capability
must not silently move from experimental to supported merely because its package exists.

The Expo provider is not a redundant implementation. It supplies the native implementation and
registration, platform source, Expo SDK compatibility, and permissions or config plugins where
applicable. Better Native supplies Effect services, typed failures, resource safety, Streams,
Atoms, and the reviewed Expo-compatible JavaScript boundary.

Each scoped capability package declares compatibility with its Expo provider and with `effect`.
Those peer declarations are validation contracts, not the installation algorithm: the CLI declares
the selected provider, scoped wrapper, and `effect` as direct application dependencies. Direct
ownership gives JavaScript resolution, Expo Autolinking, config-plugin application, and strict
package-manager layouts a stable project boundary. The installer verifies `effect` in the
application's own `package.json`; merely finding an auto-installed or hoisted peer is insufficient.

An existing Expo application normally retains its provider:

```text
Before
  expo-network

After
  expo-network
  @better-native/network
  effect
```

Exactly one compatible provider version must be selected for native autolinking, and Better Native's
JavaScript resolution must agree with that native selection. Isolated installations and monorepos
can contain additional physical copies, so the CLI diagnoses duplicates and recommends
deduplication rather than claiming that one physical instance is always enforceable. The CLI also
validates the resolved graph instead of assuming that matching package names imply matching
installations.

## Installation flows

### Existing application

An existing application adopts a capability with:

```sh
npx better-native@alpha install network
```

The CLI:

1. locates the project root and verifies that it is an Expo project;
2. resolves the installed project-local `expo` package and refuses to continue when it is absent;
3. detects the project's package manager and installed Expo SDK;
4. rejects ambiguous multiple-lockfile state unless the user selects `--npm`, `--pnpm`, `--yarn`,
   or `--bun`;
5. selects exact `@better-native/network` and Effect versions compatible with that SDK;
6. inspects the existing `expo-network` installation and native-autolinking result;
7. gives the project-local Expo CLI one package list containing the provider and exact third-party
   specifications, for example `expo-network @better-native/network@0.0.1-alpha.1
effect@4.0.0-rc.112`;
8. lets Expo select the provider version from its SDK version sources and pass the exact Better
   Native and Effect specifications through to the detected package manager;
9. validates the resulting direct dependencies, config-plugin edits, native selection, JavaScript
   resolution, and scoped package export; and
10. prints the capability status, first import, and runtime-specific rebuild result.

The CLI does not run a separate provider reinstall merely to produce visible work. When a scoped
Better Native package or Effect must be added, the compatible provider may be included in the same
Expo CLI transaction so Expo validates the complete direct dependency plan. Output still
distinguishes retained, added, updated, and invalid dependencies.

The public CLI never spawns `npx expo` internally and never invokes `@expo/cli` directly. It resolves
the `expo` package installed by the application and executes that package's CLI entrypoint with the
project root as `cwd`. This preserves the CLI version shipped with the project's Expo SDK and avoids
silently downloading another Expo CLI. `npx expo` remains the official npm spelling in manual
user-facing examples.

Example result:

```text
✓ Expo SDK 57 detected
✓ expo-network 57.0.1 retained
+ @better-native/network 0.0.1-alpha.1
+ effect 4.0.0-rc.112
✓ @better-native/network resolves
ℹ Provider already present in the current binary; no native rebuild required
```

The rebuild result is capability- and runtime-specific. It reports one of:

```text
JS-only change; no rebuild required
provider already present in the current binary; no rebuild required
native provider changed; rebuild required
config changed; regenerate native projects or integrate manually, then rebuild
Expo Go supported with documented limitations
Expo Go unavailable; development build required
```

The current five providers are present in the pinned Expo Go, but that does not erase
capability-specific limitations such as authenticated Secure Store behavior. A new provider,
changed native version, or changed config-plugin option requires a new development or production
binary. CNG projects regenerate through Expo tooling; manually managed native projects integrate the
change according to the provider's instructions.

### New Expo application with missing providers

Project creation is out of scope. After an Expo application exists and has a local `expo` package, a
developer chooses capabilities explicitly:

```sh
npx better-native@alpha install network keep-awake
```

For each missing native provider, Better Native delegates the complete exact package plan to the
project-local Expo CLI. Expo selects known provider versions using its SDK version sources,
including supported remote corrections with the installed SDK mapping as fallback. Better Native
validates the result and does not copy Expo's version map.

Conceptually, the result is:

```text
expo-network
expo-keep-awake
@better-native/network
@better-native/keep-awake
effect
```

The command must not install providers for unselected capabilities. Selected providers are direct
application dependencies even though Expo Autolinking can discover some transitive native modules;
this keeps package ownership, JavaScript resolution, config-plugin edits, and strict package-manager
layouts explicit.

### Manual installation

The CLI is the recommended coordinator, not the only supported installation path. A developer may
perform the same steps explicitly:

```sh
npx expo install expo-network @better-native/network@0.0.1-alpha.1 effect@4.0.0-rc.112
```

This is the npm spelling; the published guide also shows the equivalent Yarn, pnpm, and Bun commands.
Expo versions the known provider and passes the exact third-party specifications through unchanged.
The package documentation must describe the supported Expo, provider, and Effect ranges so manual
installation is reproducible. `better-native doctor` validates manually installed projects in the
same way as CLI-installed projects.

## Command surface

The initial public command surface is deliberately small:

```text
better-native install <capability...>
better-native doctor
```

`install` reconciles the selected capability dependencies and reports the resulting imports.
`doctor` performs read-only project and compatibility validation.

The initial release should support:

```text
better-native install keep-awake
better-native install secure-store
better-native install network
better-native install battery
better-native install clipboard
better-native doctor
```

Only capabilities allowed by the generated release registry are installable without an experimental
acknowledgement. The initial registry exposes Network, Battery, Clipboard, Keep Awake, and Secure
Store as supported prototype candidates.

The running CLI always writes exact compatibility-selected
`@better-native/<capability>@x.y.z` versions into its mutation plan. It never installs an unqualified
mutable tag. The CLI version and scoped runtime versions are independent. If a project-local CLI is
too old to understand the selected compatibility metadata, it stops with an exact CLI upgrade
command. A remotely fetched first-run CLI must retain bootstrap knowledge for every supported Expo
SDK or fail with an exact command such as:

```sh
npx better-native@<compatible-version> install network
```

The following commands are deferred until they have a distinct contract that cannot be expressed by
`install` or `doctor`:

```text
better-native add
better-native remove
better-native migrate
better-native upgrade
```

Aliases must not be introduced only to imitate another package manager. A command becomes public
only after its behavior, failure model, idempotency, and non-interactive behavior are specified and
tested.

Effect's default CLI configuration exposes Help, Version, Wizard, Completions, and LogLevel. Better
Native provides a custom `CliConfig` containing only reviewed built-ins. The initial release exposes
Help and Version; Wizard, Completions, and LogLevel remain unavailable until separately specified.
Initial command definitions do not use fallback prompts. Later interactive selection requires an
explicit interactive mode, a TTY, and a fail-fast non-interactive path.

## Drop-in routing

The primary application API uses explicit `@better-native/<capability>` imports. Explicit imports
are visible to TypeScript, Metro, test runners, editors, and developers, and therefore remain the
default installation mode.

Unchanged Expo imports may be supported as an opt-in migration facility:

```sh
npx better-native@alpha install network --drop-in
```

In that mode, the CLI configures a supported Better Native Metro integration so:

```ts
import * as Network from "expo-network"
```

may resolve to:

```text
@better-native/network/expo
```

while the real `expo-network` package remains installed as the native provider. The resolver must
prevent self-import recursion when Better Native calls the provider internally.

Drop-in routing must not become public while the Metro integration is private test infrastructure.
Publishing this mode requires the supported `@better-native/metro` package, public documentation,
compatibility tests outside the harness, and safe composition with an application's existing
`resolveRequest` implementation. Because Metro configuration commonly runs through CommonJS, that
package provides tested `import` and `require` export conditions and must not pull mobile capability
graphs into the Node configuration process.

The term "drop-in" describes the optional unchanged-import boundary. It must not imply that Better
Native replaces Expo's native code or that installing one npm package is sufficient for a capability
whose provider is absent.

## Effect implementation

The CLI is an Effect application and follows the pinned source under `vendor/effect` as its
authoritative implementation reference. Published code must import installed packages and must
never import `vendor/effect` directly.

The command tree uses:

```ts
import * as Argument from "effect/unstable/cli/Argument"
import * as CliCommand from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
```

External processes use:

```ts
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
```

The executable boundary uses:

```ts
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"
```

The executable assembles one complete `MainLive` Layer containing `NodeServices.layer`, the reviewed
`CliConfig`, and every Better Native CLI service. It creates exactly one process-owned
`ManagedRuntime` from that Layer for the entire invocation. The Layer graph is built lazily once,
its service context and memo map are shared by command parsing, planning, mutation, validation, and
rendering, and its scope owns every Layer-acquired resource.

No command, handler, or service may call `ManagedRuntime.make`, `Layer.build`, `Effect.runPromise`,
`Effect.runFork`, or another top-level Effect runner. They return Effects to the one application
boundary. `NodeRuntime.runMain` remains the outer Node signal and exit-code boundary; it runs the CLI
using the single managed context and guarantees `runtime.disposeEffect` executes exactly once after
success, failure, or interruption. Disposal closes the runtime's Layer scope before process
teardown, and the disposed runtime is never reused.

The executable wiring follows this shape:

```ts
const runtime = ManagedRuntime.make(MainLive)

const main = Effect.flatMap(runtime.contextEffect, (context) =>
  Effect.provideContext(runCommand, context),
).pipe(Effect.ensuring(runtime.disposeEffect))

NodeRuntime.runMain(main)
```

`MainLive` is created once, `ManagedRuntime.make` appears once, and `NodeRuntime.runMain` is the only
top-level runner.

Domain services do not read `process.argv`, `process.env`, the filesystem, or spawn processes
directly. Those operations remain behind services in the one managed Layer graph so command
behavior can be tested without changing a real application.

Because the pinned Effect CLI and child-process modules are unstable, Better Native isolates their
use behind narrow internal adapters. The public CLI command and error contracts must not expose
unstable Effect implementation types.

The published `better-native` package contains a bundled, Node-only artifact with its own pinned
Effect CLI and `@effect/platform-node` implementation. That artifact creates one managed runtime;
bundling must not produce a second bootstrap or runtime singleton. The CLI has no runtime dependency
on any `@better-native/<capability>` package, and capability packages have no dependency on the CLI.
This separation is a prepublish architecture requirement, not a deferred optimization.
Packed-artifact tests execute the CLI binary in clean projects; independent capability-package
bundle tests prove that mobile imports cannot reach the CLI, Node built-ins, or Node platform
modules.

The initial runner provides a custom `CliConfig` with only Help and Version. Command parsing and help
tests use `Command.runWith(args)` or a test `Stdio` layer; domain tests provide fake project,
filesystem, and process layers through one test-owned `ManagedRuntime` that is disposed after the
test scope.

## Service boundaries

The initial CLI is organized around these responsibilities:

```text
Project               locate and inspect an Expo application
PackageManager        detect and invoke npm, pnpm, Yarn, or Bun
Expo                  inspect the SDK and delegate provider installation
CommandRunner         execute inherited or captured child processes
Compatibility         select and validate supported version combinations
Installer             plan and apply dependency reconciliation
CapabilityRegistry    map command names to scoped packages, providers, and public exports
Doctor                run read-only project diagnostics
```

`CapabilityRegistry` is derived from reviewed repository truth. It must not become a second
handwritten ownership ledger that can drift from `compatibility/ownership.json` and the generated
Expo surface catalog.

`CommandRunner` is the only service that imports Effect's unstable child-process modules. It exposes
stable Better Native result and failure types to `PackageManager` and `Expo`:

- inherited execution for mutating installers, with `stdin`, `stdout`, and `stderr` inherited;
- captured execution for bounded diagnostic probes, draining stdout and stderr concurrently; and
- explicit non-zero-exit rejection for both modes.

Mutating execution uses `ChildProcessSpawner.exitCode`, which scopes the process internally.
Captured execution uses `spawn` inside `Effect.scoped`, drains both output streams, awaits the exit
code, and rejects a non-zero branded exit code. It does not use `string` or `lines` alone when
success depends on the exit status. Commands use executable and argument arrays with `shell: false`.

Delegated commands inherit the parent environment. When a command adds variables it uses
`extendEnv: true`; supplying a partial replacement environment could remove `PATH`, registry
configuration, or credentials. Plans and diagnostics list environment key names only and never
serialize the complete environment.

The installer produces a typed plan before mutating the project. Planning is read-only and records:

- the project root and detected package manager;
- any conflicting lockfiles and the explicit package-manager selection;
- the installed Expo SDK;
- requested capabilities;
- current and selected dependency versions;
- dependencies to retain, add, or update;
- commands that will be delegated to Expo or the package manager;
- package.json, app-config, and Metro files that may require an edit; and
- whether a native rebuild is required.

Interactive and non-interactive execution consume the same plan. CI mode must never wait for a
prompt. Missing required input fails in CI and other non-interactive environments; the initial
command definitions do not use Effect CLI fallback prompts or the built-in Wizard.

## Mutation and failure contract

Installation changes application state and therefore must be predictable and recoverable.

- Validate the complete plan before running the first mutating command.
- Refuse to operate outside the resolved project root.
- Pass executables and arguments separately; do not construct shell command strings.
- Resolve the project-local Expo CLI; never download or invoke a second Expo CLI implicitly.
- Preserve the project's selected package manager and lockfile.
- Stop on multiple conflicting lockfiles unless the package manager is selected explicitly.
- Do not rewrite unrelated `package.json`, Metro, or app-config fields.
- Re-read and validate state after every delegated installer completes.
- Stop after the first failed mutation and report which earlier steps succeeded.
- Never claim a rollback unless the previous files and lockfile were actually restored.
- Redact credentials and registry authentication from diagnostics.
- Support a read-only `--dry-run` plan before public mutation support is considered stable.

Failures are typed by responsibility, including project discovery, unsupported Expo SDK,
unsupported capability, incompatible dependency, package-manager execution, Expo CLI execution,
configuration conflict, and post-install validation. The final CLI boundary renders those failures
for humans and returns a non-zero exit status.

`Command.run` renders parsing and usage failures but does not render domain failures as polished
diagnostics. Better Native therefore owns a final domain-error renderer. It prints one concise
diagnostic and re-fails with the configured non-zero runtime exit code without allowing
`NodeRuntime` to print the same cause again. It never catches a failure and returns success, which
would incorrectly produce exit code zero. Effect `CliError` types remain reserved for parsing and
usage failures.

## Package and release requirements

Capability packages currently use `0.0.1-alpha.1`. The published CLI began at that version and the
Clipboard-aware CLI is `0.0.1-alpha.2`. Package versions are independent: the CLI registry records
each wrapper's exact version instead of assuming it matches the CLI. Private applications, fixtures,
Metro prototypes, and repository tooling keep their internal versions because they are not part of
the npm release. API `@since` annotations describe introduction history and are not rewritten when
the current package version changes. Registry tests reject drift between the CLI manifest, each
capability manifest, and the version selected by installation plans.

The root workspace remains non-publishable through `"private": true`. Before adding the public
`better-native` CLI workspace, rename the root package to a distinct private name such as
`@better-native/monorepo` so the workspace does not contain two packages named `better-native`.
Rename the private root `better-native` harness script at the same time and update every repository
command, workflow, and guide that invokes it.

The public CLI package must include:

- the `better-native` executable in its `bin` map;
- a bundled Node-only CLI with pinned Effect and `@effect/platform-node` internals;
- no capability API exports and no runtime dependency on scoped capability packages;
- an explicit Node.js engine range compatible with Expo and the bundled CLI;
- a license, repository metadata, and CLI documentation;
- a packed-artifact executable test; and
- npm trusted publishing through GitHub Actions with automatic provenance.

The independently published `@better-native/<capability>` packages retain their own versions,
exports, provider and application peer constraints, packed-artifact tests, and compatibility
evidence. They are not lockstep subpaths of the CLI package. A CLI release can update installation
metadata without releasing every capability, and a capability can release without republishing the
CLI when the installed CLI already understands its metadata schema.

Packed installation tests cover npm, pnpm, Yarn, and Bun with hoisted and strict or isolated
layouts. They exercise no provider, one compatible provider, one incompatible provider, duplicate
native-provider installations, and a CLI invoked transiently versus pinned as a development
dependency. Bundle tests prove that capability packages cannot reach the CLI or unrelated
capabilities.

Adding the CLI updates the root package and harness command, capability release metadata, public
installation guides, DX eval package fixtures, packed-install tests, CI references, and the release
workflow together. It does not rename scoped runtime imports or move their implementations into the
CLI package.

## Trusted npm publishing

The npm organization `better-native` governs the scoped capability packages and the future
unscoped CLI package. That npm organization name is not the GitHub trusted-publisher identity. Each
published package has its own npm Trusted Publisher configuration identifying this repository and
workflow exactly:

| Setting                     | Required value                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm package                 | `@better-native/network`, `@better-native/battery`, `@better-native/clipboard`, `@better-native/keep-awake`, `@better-native/secure-store`, or `better-native` |
| npm organization            | `better-native`                                                                                                                                                |
| Publisher                   | GitHub Actions                                                                                                                                                 |
| GitHub organization or user | `okikeSolutions`                                                                                                                                               |
| GitHub repository           | `better-native`                                                                                                                                                |
| Workflow filename           | `publish.yml`                                                                                                                                                  |
| GitHub environment          | `npm`                                                                                                                                                          |
| Allowed action              | `npm publish`                                                                                                                                                  |

The workflow filename is case-sensitive and npm expects only the filename, not
`.github/workflows/publish.yml`. Every public package's `repository.url` resolves to
`https://github.com/okikeSolutions/better-native.git` so the published metadata, provenance, and
trusted-publisher configuration agree.

The repository owns one `.github/workflows/publish.yml` workflow. It publishes one independently
selected alpha package per approved dispatch and must not rely on a long-lived npm write token. The
workflow has the following contract:

- accept only a reviewed package choice through `workflow_dispatch` on `main` and always publish it
  with the `alpha` distribution tag;
- run only in `okikeSolutions/better-native`;
- use a GitHub-hosted runner, not a self-hosted runner;
- attach the protected GitHub environment named `npm`, with required reviewers configured in the
  repository settings;
- build, test, and pack without `id-token: write`, then grant `id-token: write` only to a separate
  publish job that downloads the verified artifact;
- use Node.js 24 and npm 11.5.1 or newer, because those are npm's minimum supported trusted-
  publishing versions;
- disable package-manager caching in the Node setup step as npm recommends for trusted publishing;
- install the repository with the pinned Bun version and frozen lockfile;
- run the complete repository checks, build the selected package, inspect and install packed
  tarballs in isolated fixtures, and upload exactly one verified artifact;
- block both artifact creation and publishing on `bun run test:local-registry`, which publishes the
  CLI and all five capability packages to an isolated Verdaccio registry and exercises Keep Awake,
  Network, Secure Store, Battery, and Clipboard in that order;
- assert that each fixture gains only its selected Expo provider, scoped Better Native package, and
  `effect`, while the transient unscoped CLI remains absent from dependencies and dev dependencies;
- execute `npm publish <verified-tarball> --access public --tag alpha` directly in `publish.yml`; and
- define per-package publish concurrency with cancellation disabled so another dispatch cannot
  interrupt an active release.

Bun remains the repository package manager and runs installation, builds, tests, and the local-
registry gate. The trusted public-registry workflow deliberately uses npm CLI because npm trusted
publishing requires npm CLI 11.5.1 or newer for its GitHub OIDC exchange. `bun publish` is acceptable
for the one-time interactive bootstrap, but it does not improve the release contract: Bun documents
that an initial publication also receives `latest` alongside an explicitly selected prerelease tag.
The bootstrap therefore uses the same npm tooling as CI and explicitly removes any initial `latest`
tags after all alpha packages exist.

Third-party actions in the committed workflow are pinned to reviewed full commit SHAs. The publish
step stays in `publish.yml`, rather than a reusable called workflow, because npm validates the
calling workflow identity. The workflow contains no `NODE_AUTH_TOKEN`, npm automation token, or
write-capable registry secret. A read-only npm token may be introduced separately only if a private
dependency is genuinely required; it must not be available to the publish step.

Trusted publishing is configured separately after each real package exists in npm package settings.
The release runbook therefore treats bootstrap as an explicit one-time operation per package:
establish the real package under the `better-native` npm organization, configure the publisher
values above, then use the protected workflow for later releases. It must never reserve a name with
an empty placeholder package or quietly retain the bootstrap credential as the normal publishing
path.

### Clipboard bootstrap and CLI follow-up

Network, Battery, Keep Awake, Secure Store, and the initial CLI already exist on npm at
`0.0.1-alpha.1`. Clipboard is the remaining first publication, so npm cannot use its trusted
publisher until the package exists. After this change is merged to `main`, a maintainer with publish
permission and two-factor authentication bootstraps only Clipboard:

```sh
npm login
npm whoami
npm org ls better-native
bun install --frozen-lockfile
bun run check
bun run test:local-registry
mkdir .npm-release
npm pack ./packages/clipboard --pack-destination .npm-release
npm publish .npm-release/better-native-clipboard-0.0.1-alpha.1.tgz --access public --tag alpha
npm dist-tag rm @better-native/clipboard latest
```

Configure Clipboard's trusted publisher immediately after bootstrap. Then dispatch `publish.yml`
for `cli` to publish `better-native@0.0.1-alpha.2`; that CLI selects
`@better-native/clipboard@0.0.1-alpha.1` and preserves the existing exact versions of the other
capabilities. Existing capability packages are not republished. npm versions are immutable, so the
workflow must never attempt to republish any existing `0.0.1-alpha.1` artifact.

For a public GitHub repository publishing a public npm package, trusted publishing generates npm
provenance automatically; the workflow does not need `--provenance`. After the first verified OIDC
release, package publishing access is changed to require two-factor authentication and disallow
tokens, and every legacy npm automation or write token for that package is revoked. npm permits one
trusted publisher per package, so changing the workflow filename, repository owner, or repository
requires a coordinated npm package-settings update before the next release.

## Relationship to the compatibility harness

The public CLI and the compatibility harness have different trust and product boundaries.

The public CLI operates on a developer's application and may install dependencies or configure an
explicitly selected migration mode. The private harness prepares pinned Expo source, generates the
complete compatibility denominator, builds paired applications, runs platform evidence, and
classifies results.

The public CLI must not import harness implementation code, accept harness-only environment
protocols, or expose research commands. It may consume compact generated compatibility metadata
that is explicitly designed, versioned, and tested as a public installation input.

The root development shortcut named `better-native` currently invokes private harness tooling. It
must be renamed before the public executable is introduced so repository commands cannot be
confused with the user-facing CLI.

## Research basis

This proposal was checked against the pinned Expo and Effect sources rather than inferred from
package names alone:

- Expo package versioning and arbitrary-package pass-through:
  [`getVersionedPackages.ts`](../../expo/packages/@expo/cli/src/start/doctor/dependencies/getVersionedPackages.ts)
  and [`installAsync.ts`](../../expo/packages/@expo/cli/src/install/installAsync.ts)
- Expo's project-local CLI entrypoint: [`expo/package.json`](../../expo/packages/expo/package.json)
  and [`expo/bin/cli`](../../expo/packages/expo/bin/cli)
- Expo Autolinking traversal and duplicate behavior:
  [`autolinking.mdx`](../../expo/docs/pages/modules/autolinking.mdx) and
  [`resolution.ts`](../../expo/packages/expo-modules-autolinking/src/dependencies/resolution.ts)
- Effect CLI configuration and runner behavior:
  [`CliConfig.ts`](../vendor/effect/packages/effect/src/unstable/cli/CliConfig.ts),
  [`GlobalFlag.ts`](../vendor/effect/packages/effect/src/unstable/cli/GlobalFlag.ts), and
  [`Command.ts`](../vendor/effect/packages/effect/src/unstable/cli/Command.ts)
- Effect's process-owned Layer lifecycle:
  [`ManagedRuntime.ts`](../vendor/effect/packages/effect/src/ManagedRuntime.ts) and the pinned
  [`ManagedRuntime` integration guide](../vendor/effect/ai-docs/src/04_integration/10_managed-runtime.ts)
- Effect child-process and Node boundaries:
  [`ChildProcess.ts`](../vendor/effect/packages/effect/src/unstable/process/ChildProcess.ts),
  [`ChildProcessSpawner.ts`](../vendor/effect/packages/effect/src/unstable/process/ChildProcessSpawner.ts),
  and [`NodeServices.ts`](../vendor/effect/packages/platform-node/src/NodeServices.ts)
- npm optional-peer and executable semantics:
  [npm `package.json` documentation](https://docs.npmjs.com/cli/configuring-npm/package-json/) and
  [npm `npx` documentation](https://docs.npmjs.com/cli/commands/npx/)
- npm organization governance of unscoped packages:
  [npm organization scopes and packages](https://docs.npmjs.com/about-organization-scopes-and-packages/)
- npm OIDC publishing requirements, automatic provenance, supported runners, and package lockdown:
  [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- Node subpath and conditional export semantics:
  [Node.js package documentation](https://nodejs.org/api/packages.html)

## Deferred decisions

The following decisions remain deferred until the minimum `install` and `doctor` flows are proven:

- the exact persisted format for selected capabilities;
- the supported release boundary and configuration contract for `@better-native/metro`;
- shell-completion publication;
- automated source-import rewrites;
- capability removal and unused-provider detection;
- Expo SDK upgrade orchestration; and
- the minimum package-wide Node.js engine range supported by both Expo and the bundled CLI.

These decisions may change implementation and presentation. They must not change the package
contract: Expo selects and supplies native capability providers, the CLI installs and validates the
matching scoped Better Native package and Effect version, and application code imports the scoped
package directly.
