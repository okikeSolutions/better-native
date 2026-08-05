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

Run static checks with:

```sh
bun run typecheck
bun run check:effect
```

Run the coverage gate with:

```sh
bun run test:coverage
```

V8 coverage is intentionally scoped in `vitest.config.ts` to the current capability and
compatibility-runner implementation files. Generated registry code and tests are excluded from the
denominator. The enforced minimums are:

| Metric     | Minimum |
| ---------- | ------: |
| Statements |     95% |
| Branches   |     90% |
| Functions  |     95% |
| Lines      |     95% |

These are regression guards, not a substitute for behavior review. When a new core implementation
file is added, include it deliberately in the coverage scope and add tests before relying on the
reported aggregate.

## Capability and entrypoint tests

Each Effect-native capability test suite covers the public behavior that can be controlled on the
host:

- successful native reads;
- native rejection, unavailable, and invalid-payload failures;
- stream listener registration and scoped cleanup;
- initial Atom values, updates, bursts, and release behavior; and
- Expo-compatible entrypoint exports and hook lifecycle behavior.

Native modules are represented by controlled test doubles in this layer. That makes races and error
paths reproducible, but it does not prove an iOS or Android implementation. Tests must assert
observable outcomes—not implementation details or coverage-only branches.

The compatibility app has an `interactive-smoke` selection for Basic, Battery, and Network. It is
a developer-facing app-runner check: it proves those three generated Expo test modules are selected
and normalized together. It does not modify Expo's curated `native-e2e` cohort.

## Native parity evidence

Native parity is a paired comparison, not a host-test result:

1. Build an upstream Release app that resolves Expo APIs normally.
2. Build a candidate Release app that resolves the reviewed replacements.
3. Run the same source or explicit smoke selection on the same simulator, emulator, or device state.
4. Capture each app's chunked `BETTER_NATIVE_RESULT_V1` result and immutable build/run evidence.
5. Compare the records with `bun run better-native compare-runs`.

The curated `native-e2e` cohort remains owned by pinned Expo source and must not be changed to
improve Better Native coverage. Capability-specific parity runs are separate and opt-in.

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
