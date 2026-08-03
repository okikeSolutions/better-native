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

  it.effect("installs and launches once while retaining separate Maestro evidence per source", () =>
    Effect.gen(function* () {
      const installations = yield* Ref.make(0)
      const launches = yield* Ref.make(0)
      const flows = yield* Ref.make(0)
      const activeRun = yield* Ref.make("")
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
            runMaestroFlow: (_device, flowPath) =>
              Ref.update(flows, (count) => count + 1).pipe(
                Effect.andThen(Ref.set(activeRun, flowPath.split("/").at(-2) ?? "")),
                Effect.as([]),
              ),
            result: () =>
              Ref.get(activeRun).pipe(
                Effect.map((runId) => {
                  const sourceId = runId.endsWith("-one") ? "suite#one" : "suite#two"
                  return JSON.stringify({
                    schemaVersion: 1,
                    runId,
                    buildId: "native-build",
                    mode: "candidate",
                    results: [
                      {
                        schemaVersion: 1,
                        runId,
                        caseId: `${sourceId}#case@1`,
                        attempt: 1,
                        outcome: { _tag: "passed", durationMillis: 1 },
                        artifacts: [],
                      },
                    ],
                    runtimeDiscoveredCaseIds: [],
                  })
                }),
              ),
          }),
        ),
      )
      assert.strictEqual(yield* Ref.get(installations), 1)
      assert.strictEqual(yield* Ref.get(launches), 1)
      assert.strictEqual(yield* Ref.get(flows), 2)
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
