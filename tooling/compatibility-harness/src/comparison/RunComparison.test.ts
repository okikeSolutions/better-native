import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import {
  AttemptId,
  BuildId,
  ContentHash,
  DeviceId,
  RunId,
  TestCaseId,
  TestSourceId,
  type Expectations,
  type Mode,
  type RunRecord,
} from "../Domain.ts"
import type { ReplacementManifest } from "../registry/AppRegistry.ts"
import { compare, loadCandidateTreatmentEvidence } from "./RunComparison.ts"

const hash = ContentHash.make("0".repeat(64))
const revision = "expo-revision"
const caseId = TestCaseId.make("suite#source#case, with comma@1")
const record = (
  mode: Mode,
  outcome: RunRecord["attempts"][number]["results"][number]["outcome"],
): RunRecord => {
  const runId = RunId.make(`${mode}-run`)
  return {
    schemaVersion: 1,
    plan: {
      schemaVersion: 1,
      id: runId,
      buildId: BuildId.make(`${mode}-build`),
      platform: "web",
      unit: {
        id: "web-suite-source",
        runner: "web-app",
        platform: "web",
        sourceId: TestSourceId.make("suite#source"),
      },
      timeoutMillis: 1_000,
      retries: 0,
    },
    build: {
      schemaVersion: 1,
      id: BuildId.make(`${mode}-build`),
      mode,
      platform: "web",
      expoRevision: revision,
      candidateRevision: mode === "candidate" ? "candidate-revision" : null,
      configurationHash: hash,
      bundleHash: hash,
      nativeBinaryHash: null,
      artifacts: [],
    },
    device: {
      id: DeviceId.make("browser"),
      platform: "web",
      kind: "browser",
      name: "Chromium",
      osVersion: null,
      runtimeVersion: null,
    },
    runtimeDiscoveredCaseIds: [],
    attempts: [
      {
        schemaVersion: 1,
        id: AttemptId.make(`${mode}-attempt`),
        runId,
        attempt: 1,
        startedAtMillis: 0,
        finishedAtMillis: 1,
        infrastructure:
          outcome._tag === "passed"
            ? { _tag: "succeeded" }
            : { _tag: "runner-failed", message: "failed" },
        results: [{ schemaVersion: 1, runId, caseId, attempt: 1, outcome, artifacts: [] }],
        observations: [],
        artifacts: [],
      },
    ],
    finalInfrastructure:
      outcome._tag === "passed"
        ? { _tag: "succeeded" }
        : { _tag: "runner-failed", message: "failed" },
  }
}
const expectations = (entries: Expectations["entries"] = []): Expectations => ({
  schemaVersion: 1,
  expoRevision: revision,
  entries,
})
const passed = { _tag: "passed" as const, durationMillis: 1 }
const failed = {
  _tag: "failed" as const,
  durationMillis: 1,
  message: "boom",
  stack: null,
}
const applicabilitySkip = {
  _tag: "skipped" as const,
  reason: "not selected by pinned Expo TestModules.ts",
}
const replacementManifest: ReplacementManifest = {
  schemaVersion: 1,
  expoRevision: revision,
  ownershipFingerprint: "ownership-v1",
  replacements: [{ source: "expo-network", target: "@better-native/network/expo" }],
  trackedSpecifiers: ["expo-network"],
}

describe("RunComparison", () => {
  it("accepts exact paired passes", () => {
    const summary = compare(
      [record("upstream", passed)],
      [record("candidate", passed)],
      expectations(),
    )
    assert.deepEqual(summary.issues, [])
    assert.strictEqual(summary.matches, 1)
  })

  it("rejects candidate regressions and missing evidence", () => {
    const regression = compare(
      [record("upstream", passed)],
      [record("candidate", failed)],
      expectations(),
    )
    assert.match(regression.issues.join("\n"), /candidate failed/)
    const missing = compare([record("upstream", passed)], [], expectations())
    assert.match(missing.issues.join("\n"), /missing candidate evidence/)
    const missingSource = compare(
      [record("upstream", passed)],
      [record("candidate", passed)],
      expectations(),
      [TestSourceId.make("package-unit#packages/expo-network/src/__tests__/Network-test.ts")],
    )
    assert.match(missingSource.issues.join("\n"), /does not cover runnable sources/)
  })

  it("accepts an exact reviewed divergence and rejects its unexpected pass", () => {
    const ledger = expectations([
      {
        caseId,
        platforms: ["web"],
        expected: "fail",
        reason: "known candidate gap",
        issue: "https://example.invalid/1",
      },
    ])
    assert.deepEqual(
      compare([record("upstream", passed)], [record("candidate", failed)], ledger).issues,
      [],
    )
    assert.match(
      compare([record("upstream", passed)], [record("candidate", passed)], ledger).issues.join(
        "\n",
      ),
      /stale expectation/,
    )
    assert.match(
      compare([record("upstream", failed)], [record("candidate", failed)], ledger).issues.join(
        "\n",
      ),
      /upstream failed/,
    )
  })

  it("matches only exact paired Expo applicability skips without applying expectations", () => {
    const ledger = expectations([
      {
        caseId,
        platforms: ["web"],
        expected: "skip",
        reason: "must not mask upstream applicability",
        issue: "https://example.invalid/applicability",
      },
    ])
    const paired = compare(
      [record("upstream", applicabilitySkip)],
      [record("candidate", applicabilitySkip)],
      expectations(),
    )
    assert.deepEqual(paired.issues, [])
    assert.strictEqual(paired.matches, 1)
    assert.strictEqual(paired.expectedDivergences, 0)

    const cannotMask = compare(
      [record("upstream", applicabilitySkip)],
      [record("candidate", applicabilitySkip)],
      ledger,
    )
    assert.match(cannotMask.issues.join("\n"), /expectation cannot apply because upstream skipped/)

    const asymmetric = compare(
      [record("upstream", applicabilitySkip)],
      [record("candidate", passed)],
      expectations(),
    )
    assert.match(asymmetric.issues.join("\n"), /upstream skipped, candidate passed/)

    const ordinarySkip = { _tag: "skipped" as const, reason: "feature unavailable" }
    const nonApplicability = compare(
      [record("upstream", ordinarySkip)],
      [record("candidate", ordinarySkip)],
      expectations(),
    )
    assert.match(nonApplicability.issues.join("\n"), /non-applicability skips/)
  })

  it("rejects mixed build identities within one side of a sharded comparison", () => {
    const second = record("candidate", passed)
    const mixed: RunRecord = {
      ...second,
      plan: { ...second.plan, buildId: BuildId.make("candidate-build-2") },
      build: { ...second.build, id: BuildId.make("candidate-build-2") },
    }
    const summary = compare(
      [record("upstream", passed)],
      [record("candidate", passed), mixed],
      expectations(),
    )
    assert.match(summary.issues.join("\n"), /multiple build identities/)
  })

  it("rejects structurally empty and identity-invalid run records", () => {
    const upstream = record("upstream", passed)
    const empty: RunRecord = {
      ...upstream,
      attempts: upstream.attempts.map((attempt) => ({ ...attempt, results: [] })),
      finalInfrastructure: { _tag: "succeeded" },
    }
    const emptySummary = compare([empty], [record("candidate", passed)], expectations())
    assert.match(emptySummary.issues.join("\n"), /produced no results|observed 0 times/)

    const attempt = upstream.attempts[0]!
    const invalid: RunRecord = {
      ...upstream,
      attempts: [
        {
          ...attempt,
          runId: RunId.make("wrong-run"),
          results: attempt.results.map((result) => ({ ...result, attempt: 2 })),
        },
      ],
    }
    const invalidSummary = compare([invalid], [record("candidate", passed)], expectations())
    assert.match(invalidSummary.issues.join("\n"), /wrong run ID|wrong run or attempt identity/)
  })

  it("requires candidate resolution evidence for every owned replacement", () => {
    const missing = compare(
      [record("upstream", passed)],
      [record("candidate", passed)],
      expectations(),
      undefined,
      replacementManifest,
    )
    assert.match(missing.issues.join("\n"), /missing owned specifiers: expo-network/)
    const observed = compare(
      [record("upstream", passed)],
      [record("candidate", passed)],
      expectations(),
      undefined,
      replacementManifest,
      { resolvedSources: new Set(["expo-network"]), issues: [] },
    )
    assert.notMatch(observed.issues.join("\n"), /missing owned specifiers/)
  })

  it.effect("binds candidate treatment to run, build, fingerprint, target and outcome", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-treatment-" })
      const base = record("candidate", passed)
      const event = {
        runId: `build-${base.build.id}`,
        buildId: base.build.id,
        ownershipFingerprint: replacementManifest.ownershipFingerprint,
        mode: "candidate",
        specifier: "expo-network",
        replacement: "@better-native/network/expo",
        decision: "candidate",
        outcome: { kind: "source-file", filePath: "/workspace/packages/network/src/expo.ts" },
        resolvedTarget: "/workspace/packages/network/src/expo.ts",
        resolvedPackage: "@better-native/network",
      } as const
      const withEvent = (value: unknown): RunRecord => ({
        ...base,
        attempts: base.attempts.map((attempt) => ({
          ...attempt,
          observations: [
            {
              sequence: 1,
              timestampMillis: 1,
              stream: "stdout",
              text: `BETTER_NATIVE_RESOLUTION_V1=${JSON.stringify(value)}`,
            },
          ],
        })),
      })
      const inspect = (value: unknown) =>
        loadCandidateTreatmentEvidence(root, [withEvent(value)], replacementManifest)

      const valid = yield* inspect(event)
      assert.deepEqual(valid.issues, [])
      assert.isTrue(valid.resolvedSources.has("expo-network"))

      const cases = [
        { ...event, runId: "foreign-run" },
        { ...event, buildId: "foreign-build" },
        { ...event, ownershipFingerprint: "stale-policy" },
        { ...event, replacement: "@evil/network" },
        {
          ...event,
          outcome: { kind: "failure", name: "Error", message: "missing" },
          resolvedTarget: null,
        },
        { ...event, resolvedPackage: "expo-network" },
      ]
      for (const invalid of cases) {
        const evidence = yield* inspect(invalid)
        assert.isNotEmpty(evidence.issues)
        assert.isFalse(evidence.resolvedSources.has("expo-network"))
      }

      const staleDirectory = `${root}/stale`
      yield* fs.makeDirectory(staleDirectory)
      yield* fs.writeFileString(
        `${staleDirectory}/discovery.json`,
        JSON.stringify({
          schemaVersion: 1,
          runId: "foreign-run",
          runtimeCases: [],
          resolutions: [
            {
              schemaVersion: 1,
              id: "foreign-resolution",
              ...event,
              runId: "foreign-run",
              originModulePath: "/workspace/index.ts",
              originPackage: null,
              platform: "web",
              environment: null,
              isEsmImport: null,
              conditions: [],
              mainFields: [],
              sourceExtensions: ["ts"],
              preferNativePlatform: false,
            },
          ],
          exports: [],
        }),
      )
      const stale = yield* inspect(event)
      assert.match(stale.issues.join("\n"), /discovery references foreign run/)
    }).pipe(Effect.provide(NodeServices.layer)),
  )
})
