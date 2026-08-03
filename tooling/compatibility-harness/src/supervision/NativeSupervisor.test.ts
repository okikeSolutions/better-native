import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import { ArtifactId, BuildId, ContentHash, TestCaseId, type BuildRecord } from "../Domain.ts"
import type { BuildOutput } from "./BuildPipeline.ts"
import { EvidenceStore } from "./EvidenceStore.ts"
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
  caseIds: [TestCaseId.make("suite#source#case@1")],
  sourceIds: [],
  permissionState: "granted" as const,
  timeoutMillis: 1_000,
}

const evidence = Layer.succeed(
  EvidenceStore,
  EvidenceStore.of({
    writeBytes: () => Effect.die("unexpected evidence write"),
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
    openUrl: () => Effect.void,
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
