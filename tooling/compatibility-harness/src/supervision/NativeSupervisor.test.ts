import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import { ArtifactId, BuildId, ContentHash, TestSourceId, type BuildRecord } from "../Domain.ts"
import type { BuildOutput } from "../build/BuildPipeline.ts"
import { EvidenceStore } from "../evidence/EvidenceStore.ts"
import { NativeSupervisor, layer } from "./NativeSupervisor.ts"
import {
  PlatformDriverError,
  PlatformDrivers,
  iosLogPredicate,
  maestroJUnitPassed,
  resultFromHierarchy,
  type NativeDevice,
  type Service as DriverService,
} from "./PlatformDrivers.ts"

const hash = ContentHash.make("0".repeat(64))
const record: BuildRecord = {
  schemaVersion: 2,
  id: BuildId.make("native-build"),
  mode: "candidate",
  platform: "ios",
  expoRevision: "expo-revision",
  candidateRevision: "candidate-revision",
  configurationHash: hash,
  bundleHash: hash,
  nativeBinaryHash: hash,
  nativeFingerprint: null,
  toolchainFingerprint: null,
  buildDecision: "full-build",
  nativeArtifact: null,
  performance: { architecture: "test", phases: [], caches: [] },
  artifacts: [],
}
const build: BuildOutput = {
  record,
  workspace: "/workspace",
  appDirectory: "/workspace/app",
  output: "/workspace/App.app",
  expoCli: "/pinned/packages/expo/bin/cli",
  observations: [],
}
const device: NativeDevice = {
  platform: "ios",
  id: "simulator",
  applicationId: "dev.betternative.compatibility",
}
const request = {
  id: "native-run",
  build,
  device,
  unit: {
    id: "ios-suite_source-1",
    runner: "native-app" as const,
    platform: "ios" as const,
    sourceId: TestSourceId.make("suite#source"),
  },
  timeoutMillis: 1_000,
}

const evidence = Layer.succeed(
  EvidenceStore,
  EvidenceStore.of({
    writeBytes: (_collection, recordId, name) =>
      Effect.succeed({
        id: ArtifactId.make(`runs/${recordId}/${name}@${hash}`),
        path: `.artifacts/runs/${recordId}/${name}`,
        mediaType: "application/yaml",
        size: 0,
        hash,
      }),
    writeJson: (_collection, recordId, name) =>
      Effect.succeed({
        id: ArtifactId.make(`runs/${recordId}/${name}@${hash}`),
        path: `.artifacts/runs/${recordId}/${name}`,
        mediaType: "application/json",
        size: 0,
        hash,
      }),
  }),
)

const drivers = (overrides: Partial<DriverService>) => {
  const service: DriverService = {
    install: () => Effect.void,
    runMaestroFlow: () => Effect.succeed([]),
    isAlive: () => Effect.succeed(true),
    logs: () => Effect.succeed([]),
    result: () => Effect.succeed(null),
    ...overrides,
  }
  return Layer.succeed(PlatformDrivers, PlatformDrivers.of(service))
}

const supervisorLayer = (service: Partial<DriverService>) =>
  layer.pipe(Layer.provideMerge(Layer.merge(drivers(service), evidence)))

describe("NativeSupervisor fault injection", () => {
  it("collects React Native and host-process errors without a launch PID registry", () => {
    assert.strictEqual(
      iosLogPredicate,
      'eventMessage CONTAINS "BETTER_NATIVE_" OR subsystem == "com.facebook.react.log" OR (process == "BetterNativeCompatibility" AND (messageType == "Error" OR messageType == "Fault"))',
    )
  })

  it.effect("runs one native cohort while retaining separate evidence per source", () =>
    Effect.gen(function* () {
      const installations = yield* Ref.make(0)
      const flows = yield* Ref.make(0)
      const nativeLogs = yield* Ref.make(0)
      const records = yield* Effect.gen(function* () {
        const supervisor = yield* NativeSupervisor
        return yield* supervisor.runBatch({
          id: "native-batch",
          build,
          device,
          units: [
            {
              id: "one",
              runner: "native-app",
              platform: "ios",
              sourceId: TestSourceId.make("suite#one"),
            },
            {
              id: "two",
              runner: "native-app",
              platform: "ios",
              sourceId: TestSourceId.make("suite#two"),
            },
          ],
          timeoutMillis: 1_000,
        })
      }).pipe(
        Effect.provide(
          supervisorLayer({
            install: () => Ref.update(installations, (count) => count + 1),
            runMaestroFlow: () => Ref.update(flows, (count) => count + 1).pipe(Effect.as([])),
            logs: () => Ref.update(nativeLogs, (count) => count + 1).pipe(Effect.as([])),
            result: () =>
              Effect.succeed(
                JSON.stringify({
                  schemaVersion: 1,
                  runId: "native-batch",
                  buildId: "native-build",
                  mode: "candidate",
                  results: ["suite#one", "suite#two"].map((sourceId) => ({
                    schemaVersion: 1,
                    runId: "native-batch",
                    caseId: `${sourceId}#case@1`,
                    attempt: 1,
                    outcome: { _tag: "passed", durationMillis: 1 },
                    artifacts: [],
                  })),
                  runtimeDiscoveredCaseIds: [],
                }),
              ),
          }),
        ),
      )
      assert.strictEqual(yield* Ref.get(installations), 1)
      assert.strictEqual(yield* Ref.get(flows), 1)
      assert.strictEqual(yield* Ref.get(nativeLogs), 0)
      assert.lengthOf(records, 2)
      assert.deepEqual(
        records.map((runRecord) => runRecord.attempts[0]?.artifacts.length),
        [1, 1],
      )
    }),
  )

  it.effect("pairs two products as install-flow-install-flow on one device", () =>
    Effect.gen(function* () {
      const events = yield* Ref.make<ReadonlyArray<string>>([])
      const summaries = yield* Ref.make([
        JSON.stringify({
          schemaVersion: 1,
          runId: "pair-upstream",
          buildId: "upstream-build",
          mode: "upstream",
          results: [
            {
              schemaVersion: 1,
              runId: "pair-upstream",
              caseId: "suite#source#case@1",
              attempt: 1,
              outcome: { _tag: "passed", durationMillis: 1 },
              artifacts: [],
            },
          ],
          runtimeDiscoveredCaseIds: [],
        }),
        JSON.stringify({
          schemaVersion: 1,
          runId: "pair-candidate",
          buildId: "native-build",
          mode: "candidate",
          results: [
            {
              schemaVersion: 1,
              runId: "pair-candidate",
              caseId: "suite#source#case@1",
              attempt: 1,
              outcome: { _tag: "passed", durationMillis: 1 },
              artifacts: [],
            },
          ],
          runtimeDiscoveredCaseIds: [],
        }),
      ])
      const upstreamBuild: BuildOutput = {
        ...build,
        output: "/workspace/Upstream.app",
        record: {
          ...record,
          id: BuildId.make("upstream-build"),
          mode: "upstream",
          candidateRevision: null,
        },
      }
      yield* Effect.gen(function* () {
        const supervisor = yield* NativeSupervisor
        yield* supervisor.runBatch({
          id: "pair-upstream",
          build: upstreamBuild,
          device,
          units: [request.unit],
          timeoutMillis: 1_000,
        })
        yield* supervisor.runBatch({
          id: "pair-candidate",
          build,
          device,
          units: [request.unit],
          timeoutMillis: 1_000,
        })
      }).pipe(
        Effect.provide(
          supervisorLayer({
            install: (_device, binary) =>
              Ref.update(events, (current) => [...current, `install:${binary}`]),
            runMaestroFlow: () =>
              Ref.update(events, (current) => [...current, "flow"]).pipe(Effect.as([])),
            result: () => Ref.modify(summaries, ([head, ...tail]) => [head ?? null, tail] as const),
          }),
        ),
      )
      assert.deepStrictEqual(yield* Ref.get(events), [
        "install:/workspace/Upstream.app",
        "flow",
        "install:/workspace/App.app",
        "flow",
      ])
    }),
  )

  it("extracts the result from Expo-style Maestro hierarchy output", () => {
    const result = '{"schemaVersion":1}'
    const hierarchy = {
      attributes: { text: "root" },
      children: [
        {
          attributes: {
            "resource-id": "dev.betternative.compatibility:id/compatibility_run_result_json",
            accessibilityText: "compatibility_run_result_json",
            text: result,
          },
        },
      ],
    }
    assert.strictEqual(
      resultFromHierarchy(`Maestro diagnostics\n${JSON.stringify(hierarchy)}`),
      result,
    )
    assert.isNull(resultFromHierarchy("not json"))
  })

  it("accepts only complete, passing Maestro JUnit reports", () => {
    assert.isTrue(
      maestroJUnitPassed(
        '<testsuites><testsuite tests="1" failures="0" errors="0" /></testsuites>',
      ),
    )
    assert.isFalse(
      maestroJUnitPassed(
        '<testsuites><testsuite tests="1" failures="1"><testcase><failure /></testcase></testsuite></testsuites>',
      ),
    )
    assert.isFalse(maestroJUnitPassed("not a JUnit report"))
  })

  it.effect("classifies a Maestro assertion as a runner failure", () =>
    Effect.gen(function* () {
      const supervisor = yield* NativeSupervisor
      const failure = yield* supervisor
        .runBatch({
          id: "native-batch",
          build,
          device,
          units: [request.unit],
          timeoutMillis: 1_000,
        })
        .pipe(Effect.flip)
      assert.strictEqual(failure.phase, "runner")
    }).pipe(
      Effect.provide(
        supervisorLayer({
          runMaestroFlow: () =>
            Effect.fail(
              new PlatformDriverError({
                operation: "maestro",
                device,
                cause: "injected assertion failure",
              }),
            ),
        }),
      ),
    ),
  )

  it.effect("persists evidence when the app crashes during a Maestro flow", () =>
    Effect.gen(function* () {
      const writtenRecords = yield* Ref.make<ReadonlyArray<string>>([])
      const recordingEvidence = Layer.succeed(
        EvidenceStore,
        EvidenceStore.of({
          writeBytes: (_collection, recordId, name) =>
            Effect.succeed({
              id: ArtifactId.make(`runs/${recordId}/${name}@${hash}`),
              path: `.artifacts/runs/${recordId}/${name}`,
              mediaType: "application/yaml",
              size: 0,
              hash,
            }),
          writeJson: (_collection, recordId, name) =>
            Ref.update(writtenRecords, (records) => [...records, `${recordId}/${name}`]).pipe(
              Effect.as({
                id: ArtifactId.make(`runs/${recordId}/${name}@${hash}`),
                path: `.artifacts/runs/${recordId}/${name}`,
                mediaType: "application/json",
                size: 0,
                hash,
              }),
            ),
        }),
      )
      const failure = yield* Effect.gen(function* () {
        const supervisor = yield* NativeSupervisor
        return yield* supervisor
          .runBatch({
            id: "native-batch",
            build,
            device,
            units: [request.unit],
            timeoutMillis: 1_000,
          })
          .pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          layer.pipe(
            Layer.provideMerge(
              Layer.merge(
                drivers({
                  runMaestroFlow: () =>
                    Effect.fail(
                      new PlatformDriverError({
                        operation: "maestro",
                        device,
                        cause: "application disappeared",
                      }),
                    ),
                  isAlive: () => Effect.succeed(false),
                }),
                recordingEvidence,
              ),
            ),
          ),
        ),
      )
      assert.strictEqual(failure.phase, "crash")
      assert.deepEqual(yield* Ref.get(writtenRecords), ["native-batch/record.json"])
    }),
  )

  it.effect("rejects malformed in-app protocol output", () =>
    Effect.gen(function* () {
      const supervisor = yield* NativeSupervisor
      const failure = yield* supervisor.run(request).pipe(Effect.flip)
      assert.strictEqual(failure.phase, "protocol")
    }).pipe(
      Effect.provide(
        supervisorLayer({
          result: () => Effect.succeed("{broken-json"),
        }),
      ),
    ),
  )

  it.effect("checks liveness only after Maestro fails", () =>
    Effect.gen(function* () {
      const livenessChecks = yield* Ref.make(0)
      const failure = yield* Effect.gen(function* () {
        const supervisor = yield* NativeSupervisor
        return yield* supervisor.run(request).pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          supervisorLayer({
            runMaestroFlow: () =>
              Effect.fail(
                new PlatformDriverError({
                  operation: "maestro",
                  device,
                  cause: "deep-link launch failed",
                }),
              ),
            isAlive: () => Ref.update(livenessChecks, (count) => count + 1).pipe(Effect.as(false)),
          }),
        ),
      )
      assert.strictEqual(failure.phase, "crash")
      assert.strictEqual(yield* Ref.get(livenessChecks), 1)
    }),
  )
})
