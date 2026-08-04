import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import { ArtifactId, BuildId, ContentHash, TestSourceId, type BuildRecord } from "../Domain.ts"
import type { BuildOutput } from "../build/BuildPipeline.ts"
import { EvidenceStore } from "../evidence/EvidenceStore.ts"
import { NativeSupervisor, NativeSupervisorError, layer } from "./NativeSupervisor.ts"
import {
  PlatformDriverError,
  PlatformDrivers,
  iosLaunchProcessId,
  iosLivenessSpec,
  iosLogPredicate,
  maestroJUnitPassed,
  resultFromHierarchy,
  type NativeDevice,
  type Service as DriverService,
} from "./PlatformDrivers.ts"

const hash = ContentHash.make("0".repeat(64))
const record: BuildRecord = {
  schemaVersion: 1,
  id: BuildId.make("native-build"),
  mode: "candidate",
  platform: "ios",
  expoRevision: "expo-revision",
  candidateRevision: "candidate-revision",
  configurationHash: hash,
  bundleHash: hash,
  nativeBinaryHash: hash,
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
  permissionState: "granted" as const,
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
    grantPermissions: () => Effect.void,
    reset: () => Effect.void,
    launch: () => Effect.succeed({ alive: true, crashed: false, logs: [] }),
    runMaestroFlow: () => Effect.succeed([]),
    isAlive: () => Effect.succeed(true),
    logs: () => Effect.succeed([]),
    result: () => Effect.succeed(null),
    cleanup: () => Effect.void,
    ...overrides,
  }
  return Layer.succeed(PlatformDrivers, PlatformDrivers.of(service))
}

const supervisorLayer = (service: Partial<DriverService>) =>
  layer.pipe(Layer.provideMerge(Layer.merge(drivers(service), evidence)))

describe("NativeSupervisor fault injection", () => {
  it("tracks iOS simulator liveness by the host PID reported by simctl", () => {
    assert.strictEqual(iosLaunchProcessId("dev.betternative.compatibility: 96141"), 96141)
    assert.isNull(iosLaunchProcessId("dev.betternative.compatibility: not-a-pid"))
    assert.deepEqual(iosLivenessSpec(96141), {
      command: "/bin/kill",
      args: ["-0", "96141"],
      timeoutMillis: 5_000,
    })
    assert.strictEqual(
      iosLogPredicate(96141),
      'eventMessage CONTAINS "BETTER_NATIVE_" OR (processIdentifier == 96141 AND (messageType == "Error" OR messageType == "Fault"))',
    )
  })

  it.effect("keeps permissions reset when that scenario is requested", () =>
    Effect.gen(function* () {
      const granted = yield* Ref.make(false)
      yield* Effect.gen(function* () {
        const supervisor = yield* NativeSupervisor
        yield* supervisor.run({ ...request, permissionState: "reset" }).pipe(Effect.ignore)
      }).pipe(
        Effect.provide(
          supervisorLayer({
            grantPermissions: () => Ref.set(granted, true),
            launch: () => Effect.succeed({ alive: false, crashed: true, logs: [] }),
          }),
        ),
      )
      assert.isFalse(yield* Ref.get(granted))
    }),
  )

  it.effect("runs one native cohort while retaining separate evidence per source", () =>
    Effect.gen(function* () {
      const installations = yield* Ref.make(0)
      const launches = yield* Ref.make(0)
      const flows = yield* Ref.make(0)
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
          permissionState: "granted",
          timeoutMillis: 1_000,
        })
      }).pipe(
        Effect.provide(
          supervisorLayer({
            install: () => Ref.update(installations, (count) => count + 1),
            launch: () =>
              Ref.update(launches, (count) => count + 1).pipe(
                Effect.as({ alive: true, crashed: false, logs: [] }),
              ),
            runMaestroFlow: () => Ref.update(flows, (count) => count + 1).pipe(Effect.as([])),
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
      assert.strictEqual(yield* Ref.get(launches), 1)
      assert.strictEqual(yield* Ref.get(flows), 1)
      assert.lengthOf(records, 2)
      assert.deepEqual(
        records.map((runRecord) => runRecord.attempts[0]?.artifacts.length),
        [1, 1],
      )
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

  it.effect("classifies a native launch crash", () =>
    Effect.gen(function* () {
      const supervisor = yield* NativeSupervisor
      const failure = yield* supervisor.run(request).pipe(Effect.flip)
      assert.instanceOf(failure, NativeSupervisorError)
      assert.strictEqual(failure.phase, "crash")
    }).pipe(
      Effect.provide(
        supervisorLayer({
          launch: () => Effect.succeed({ alive: false, crashed: true, logs: [] }),
        }),
      ),
    ),
  )

  it.effect("persists evidence when a native batch crashes during launch", () =>
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
            permissionState: "granted",
            timeoutMillis: 1_000,
          })
          .pipe(Effect.flip)
      }).pipe(
        Effect.provide(
          layer.pipe(
            Layer.provideMerge(
              Layer.merge(
                drivers({
                  launch: () => Effect.succeed({ alive: false, crashed: true, logs: [] }),
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

  it.effect("does not hide cleanup failures", () => {
    const cleanupFailure = new PlatformDriverError({
      operation: "cleanup",
      device,
      cause: "injected cleanup failure",
    })
    return Effect.gen(function* () {
      const supervisor = yield* NativeSupervisor
      const failure = yield* supervisor.run(request).pipe(Effect.flip)
      assert.strictEqual(failure.phase, "device")
      assert.match(String(failure.cause), /cleanup/i)
    }).pipe(
      Effect.provide(
        supervisorLayer({
          launch: () => Effect.succeed({ alive: false, crashed: true, logs: [] }),
          cleanup: () => Effect.fail(cleanupFailure),
        }),
      ),
    )
  })

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

  it.effect("classifies a crash after deep-link launch instead of waiting for timeout", () =>
    Effect.gen(function* () {
      const supervisor = yield* NativeSupervisor
      const failure = yield* supervisor.run(request).pipe(Effect.flip)
      assert.strictEqual(failure.phase, "crash")
    }).pipe(
      Effect.provide(
        supervisorLayer({
          result: () => Effect.succeed(null),
          isAlive: () => Effect.succeed(false),
        }),
      ),
    ),
  )
})
