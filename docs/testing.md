# Testing strategy

better-native uses layered tests. No single layer proves compatibility by itself:

- TypeScript and Effect diagnostics prove static contracts;
- host tests prove behavior deterministically;
- coverage gates prevent untested regressions in selected core code;
- app-runner tests prove registry selection and result normalization; and
- paired native runs prove that upstream Expo and the candidate have the same observed behavior.

## Host tests and coverage

Run all host tests with:

```sh
bun run test
```

The host suite excludes Vitest Evals task controls. Run the secretless reference, no-op, and broken
controls through their dedicated configuration with:

```sh
bun run evals validate
```

Keeping these suites separate prevents package eval subprocesses from competing with host-test
workers. Deterministic eval validation uses at most two files in parallel, while paid campaigns
remain serialized. Vitest's experimental filesystem module cache is enabled for both suites so
repeated migration-focused invocations can reuse transformed modules. The host suite reserves half
of the available logical CPUs for the compiler, Podman, Metro, and other child processes launched
by its workers, with a four-worker ceiling to avoid sandbox availability failures. Native-package
reference and negative compile contracts use one test file per
scenario under `tooling/dx-evals/src/agent/compile-contracts`, allowing Vitest and CI shards to
schedule each isolated container compilation independently. Podman conformance tests are grouped
by security boundary under `tooling/dx-evals/src/security/isolation` so filesystem, network,
observation-integrity, runtime-restriction, and timeout checks can be scheduled separately.
Synthetic TrialRunner controls are likewise split by adapter and diagnostic scenario under
`tooling/dx-evals/src/trial-runner`.

Run static checks with:

```sh
bun run typecheck
bun run check:effect
```

Run the coverage gate with:

```sh
bun run test:coverage
```

V8 coverage is intentionally scoped in `vitest.config.ts` to product runtime code and both tooling
controllers. Generated code and tests are excluded from the denominator. Every directory matching
`packages/*/src` is discovered when Vitest starts and receives its own threshold group. A new
package therefore enters root coverage automatically and cannot hide behind aggregate coverage
from existing packages. The application and tooling controllers have independent groups as well:

| Scope                                              | Statements | Branches | Functions | Lines |
| -------------------------------------------------- | ---------: | -------: | --------: | ----: |
| Each product package and compatibility-app runtime |        95% |      90% |       95% |   95% |
| Compatibility-harness controller                   |        70% |      65% |       63% |   70% |
| DX-evals controller                                |        80% |      70% |       78% |   80% |
| DX compile-diagnostic sanitizer                    |       100% |      77% |      100% |  100% |

The tooling thresholds are regression floors backed by deterministic eval controls and the
read-only compatibility-denominator integration. They should rise as command, reporting, and
provider-boundary tests are added. The aggregate percentage printed by Vitest is informational—the
glob thresholds above are the gates.

The root suite uses Vitest's isolated `threads` pool. Threads avoid fork startup overhead while
isolation remains enabled because tests exercise process environment, module mocks, managed-runtime
disposal, and filesystem/process boundaries. Do not disable isolation globally without proving
those contracts remain independent.

Code executed in Podman, Node workers, browser processes, simulators, or other child processes is
not attributed to the parent Vitest V8 session. Such entrypoints are not mixed into the controller
denominator as false zeroes. Their behavior is instead required through protocol, isolation,
supervision, lifecycle, and paired-execution conformance tests. Pure runner utilities executed in
the Vitest process, currently the DX compile-diagnostic sanitizer, remain in the coverage gate.

These are regression guards, not a substitute for behavior review. Product files under
`packages/*/src` and controller files under the configured tooling roots are included automatically.
External-process entrypoints must be placed in an explicit external-process scope and tested at
their observable boundary.

## Capability and entrypoint tests

Effect-native capability test suites cover the applicable public behavior that can be controlled on
the host:

- successful native reads;
- native rejection, unavailable, and invalid-payload failures;
- stream listener registration and scoped cleanup;
- secure key-value reads, writes, deletion, option forwarding, and typed native failures;
- initial Atom values, updates, bursts, and release behavior; and
- Expo-compatible entrypoint exports and hook lifecycle behavior.

Native modules are represented by controlled test doubles in this layer. That makes races and error
paths reproducible, but it does not prove an iOS or Android implementation. Tests must assert
observable outcomes—not implementation details or coverage-only branches.

The compatibility app has an `interactive-smoke` selection for Basic, Battery, KeepAwake, Network,
and SecureStore. It is a developer-facing app-runner check: it proves those five generated Expo test
modules are selected and normalized together. It does not modify Expo's curated `native-e2e`
cohort.

## Native parity evidence

Native parity is a paired comparison, not a host-test result:

1. Build an upstream Release app that resolves Expo APIs normally.
2. Build a candidate Release app that resolves the reviewed replacements.
3. Run the same source or explicit smoke selection on the same simulator, emulator, or device state.
4. Capture each app's chunked `BETTER_NATIVE_RESULT_V1` result and immutable build/run evidence.
5. Compare the records with `bun run compatibility-harness compare-runs`.

The curated `native-e2e` cohort remains owned by pinned Expo source and must not be changed to
improve Better Native coverage. Capability-specific parity runs are separate and opt-in.
Use `--source <source-id>` on paired web or native execution and on `compare-runs` for these scoped
runs. Reviewed supplemental sources may cover a platform behavior that the pinned source cannot
validly exercise; they must remain separate from the upstream native cohort and explain that scope.
The reviewed KeepAwake capability is one such source: it is selectable on web, iOS, and Android and
exercises balanced tags, hook mount/unmount, listener cleanup, web release events, platform-specific
errors, and concurrent-tag isolation. Its inclusion does not add it to Expo's curated native cohort.
The reviewed Network and Battery Effect capabilities are likewise selectable without changing that
cohort. Network exercises live state and IPv4 reads, airplane-mode values or typed native
unavailability, Stream acquisition and release, and Atom hydration. Battery exercises every live
read, the combined power state, all three native Stream lifecycles, and all four Atom lifecycles.
Paired Release comparisons for both sources pass on web, iOS, and Android with zero divergences.
The reviewed SecureStore web capability is separately selectable on web and exercises Expo's actual
unavailable result plus typed `SecureStoreFailure` mapping for unsupported asynchronous and
synchronous storage operations. It does not claim iOS or Android behavior.
The native SecureStore capability is separately selectable on iOS and Android and exercises
`SecureStore.live`, raw-Expo capability-result agreement, synchronous and asynchronous round trips,
deletion and `null`, keychain-service isolation, and typed validation failure. An additional iOS-only
source exercises a missing-keychain-entitlement failure. Biometric writes, authenticated reads,
success, and cancellation remain physical-device evidence because unattended simulator runs do not
reliably display an authentication prompt—even when biometric capability reports unavailable.

Android executes the complete pinned cohort in one app session. Hosted iOS CI partitions the same
unchanged source set into two deterministic shards, balanced by each source's statically discovered
case count. Each shard still runs as one app session; the split keeps the 291-case suite within the
simulator deadline, and paired comparison merges both shards before checking source completeness.

Simulator results are platform evidence, with platform limits. For example, iOS Simulator correctly
proves Expo Battery's unavailable behavior, but it cannot prove live battery level, charging, or
low-power events. Those cases require a physical iPhone. Simulator network state and IP behavior
can be compared; Android-only airplane-mode behavior requires an Android device or emulator.

## Evidence standard

Use the strongest applicable claim:

| Evidence                      | What it proves                                                         | What it does not prove                                 |
| ----------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| Unit test                     | Host-side behavior under controlled native responses                   | Native module behavior                                 |
| Coverage gate                 | Selected implementation paths remain exercised                         | Correctness of uncovered environments or native parity |
| Compatibility app runner      | Source selection, Jasmine result normalization, and Metro graph wiring | Device-native behavior                                 |
| Paired simulator/emulator run | Upstream and candidate behavior on that platform                       | Behavior unavailable on that platform                  |
| Paired physical-device run    | Upstream and candidate behavior for hardware-backed APIs               | Other devices and operating systems                    |

Record platform, runtime, build identity, source/case IDs, and artifacts with every native verdict.
An expected divergence requires a reviewed entry in `compatibility/expectations.json`; an unrecorded
difference is a failed parity result.
