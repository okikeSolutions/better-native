import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import { BuildId, ContentHash, RunId, TestSourceId, type ProcessObservation } from "../Domain.ts"
import { provideLayer } from "../TestLayers.ts"
import { DiscoveryPass } from "../evidence/DiscoveryPass.ts"
import { EvidenceStore, layer as evidenceLayer } from "../evidence/EvidenceStore.ts"
import { ProcessFailure, ProcessSupervisor, type RunningProcess } from "./ProcessSupervisor.ts"
import {
  appendBrowserConsoleObservations,
  BrowserDriver,
  BrowserDriverError,
  browserPermissionsForSource,
  diagnosticMessage,
  makeBoundedConsoleCollector,
  persistWebRunFailure,
  validateBrowserResultPayload,
  webRunUrl,
  WebSupervisor,
  WebSupervisorError,
  withServerFailureEvidence,
  layer as webSupervisorLayer,
  type WebRunRequest,
} from "./WebSupervisor.ts"

const request: WebRunRequest = {
  id: RunId.make("web-failure"),
  build: {
    record: {
      schemaVersion: 2,
      id: BuildId.make("web-build"),
      mode: "upstream",
      platform: "web",
      expoRevision: "expo-revision",
      candidateRevision: null,
      configurationHash: ContentHash.make("configuration-hash"),
      bundleHash: ContentHash.make("bundle-hash"),
      nativeBinaryHash: null,
      nativeFingerprint: null,
      toolchainFingerprint: null,
      buildDecision: "bundle",
      nativeArtifact: null,
      performance: { architecture: "test", phases: [], caches: [] },
      artifacts: [],
    },
    workspace: "/workspace",
    appDirectory: "/workspace/app",
    output: "/workspace/dist",
    expoCli: "/workspace/expo-cli",
    observations: [],
  },
  unit: {
    id: "web-source-one",
    runner: "web-app",
    platform: "web",
    sourceId: TestSourceId.make("source one"),
  },
  port: 8_081,
  timeoutMillis: 1_000,
  corpus: {
    schemaVersion: 1,
    expoRevision: "expo-revision",
    fingerprint: "corpus-fingerprint",
    sources: [],
    cases: [],
  },
}

describe("WebSupervisor failure evidence", () => {
  it("retains structured Effect error reasons", () => {
    assert.strictEqual(
      diagnosticMessage({
        _tag: "BrowserDriverError",
        cause: { _tag: "RunSelectionError", reason: "source registered no cases" },
      }),
      "BrowserDriverError: RunSelectionError: source registered no cases",
    )
  })

  it.effect("persists a structured failure record for unsuccessful browser runs", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-web-failure-" })
      const failure = new WebSupervisorError({
        phase: "browser",
        request,
        cause: new BrowserDriverError({
          cause: { _tag: "RunSelectionError", reason: "injected selection failure" },
          console: [],
        }),
        observations: [
          { sequence: 0, timestampMillis: 1, stream: "stderr", text: "browser failed" },
        ],
      })
      const plan = {
        schemaVersion: 1 as const,
        id: RunId.make(request.id),
        buildId: request.build.record.id,
        platform: "web" as const,
        unit: request.unit,
        timeoutMillis: request.timeoutMillis,
        retries: 0,
      }
      yield* Effect.gen(function* () {
        const evidence = yield* EvidenceStore
        yield* persistWebRunFailure(evidence, request.id, plan, failure)
      }).pipe(provideLayer(evidenceLayer(root).pipe(Layer.provideMerge(NodeServices.layer))))
      const persisted: unknown = JSON.parse(
        yield* fs.readFileString(`${root}/.artifacts/runs/${request.id}/failure.json`),
      )
      if (typeof persisted !== "object" || persisted === null) {
        throw new Error("persisted web failure is not an object")
      }
      const message = Reflect.get(persisted, "message")
      const observations = Reflect.get(persisted, "observations")
      assert.isString(message)
      assert.match(message, /RunSelectionError: injected selection failure/)
      assert.isArray(observations)
      assert.strictEqual(observations.length, 1)
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it("uses one short source selection in the web URL", () => {
    const url = webRunUrl(8_081, request.id, request.unit.sourceId)
    assert.strictEqual(url, "http://127.0.0.1:8081/run?runId=web-failure&source=source+one")
    assert.isBelow(url.length, 16_384)
  })

  it("grants only the browser capabilities required by the selected source", () => {
    assert.deepEqual(
      browserPermissionsForSource("expo-app-suite#apps/test-suite/tests/Clipboard.js"),
      ["clipboard-read", "clipboard-write"],
    )
    assert.deepEqual(
      browserPermissionsForSource("expo-app-suite#apps/test-suite/tests/KeepAwake.js"),
      ["screen-wake-lock"],
    )
    assert.deepEqual(
      browserPermissionsForSource(
        "better-native-capability#apps/compatibility-suite/src/capabilities/KeepAwake.ts",
      ),
      ["screen-wake-lock"],
    )
    assert.deepEqual(
      browserPermissionsForSource("expo-app-suite#apps/test-suite/tests/Network.js"),
      [],
    )
  })

  it.effect("starts one server and executes every source in the shared web session", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-web-session-" })
      const starts = yield* Ref.make(0)
      const terminations = yield* Ref.make(0)
      const executions = yield* Ref.make(0)
      const process = {
        exitCode: Effect.never,
        observations: Effect.succeed<ReadonlyArray<ProcessObservation>>([]),
        terminate: Ref.update(terminations, (value) => value + 1),
      }
      const processLayer = Layer.succeed(
        ProcessSupervisor,
        ProcessSupervisor.of({
          start: () => Ref.update(starts, (value) => value + 1).pipe(Effect.as(process)),
          run: () => Effect.succeed({ exitCode: 0, observations: [] }),
        }),
      )
      const browserLayer = Layer.succeed(
        BrowserDriver,
        BrowserDriver.of({
          execute: (url) =>
            Effect.gen(function* () {
              yield* Ref.update(executions, (value) => value + 1)
              const selection = new URL(url)
              const runId = selection.searchParams.get("runId") ?? "missing-run"
              const sourceId = selection.searchParams.get("source") ?? "missing-source"
              const caseId = `${sourceId}#case@1`
              return {
                resultJson: JSON.stringify({
                  schemaVersion: 1,
                  runId,
                  buildId: request.build.record.id,
                  mode: request.build.record.mode,
                  results: [
                    {
                      schemaVersion: 1,
                      runId,
                      caseId,
                      attempt: 1,
                      outcome: { _tag: "passed", durationMillis: 1 },
                      artifacts: [],
                    },
                  ],
                  runtimeDiscoveredCaseIds: [caseId],
                }),
                console: [],
              }
            }),
        }),
      )
      const discoveryLayer = Layer.succeed(
        DiscoveryPass,
        DiscoveryPass.of({
          collect: (input) =>
            Effect.succeed({
              schemaVersion: 1,
              runId: input.runId,
              runtimeCases: [],
              resolutions: [],
              exports: [],
            }),
        }),
      )
      const live = webSupervisorLayer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            browserLayer,
            processLayer,
            discoveryLayer,
            evidenceLayer(root).pipe(Layer.provideMerge(NodeServices.layer)),
          ),
        ),
      )
      const second: WebRunRequest = {
        ...request,
        id: RunId.make("web-second"),
        unit: {
          ...request.unit,
          id: "web-source-two",
          sourceId: TestSourceId.make("source two"),
        },
      }
      const records = yield* Effect.gen(function* () {
        const supervisor = yield* WebSupervisor
        const completed = yield* supervisor.runAll([request, second])
        const incompatible = yield* supervisor
          .runAll([
            request,
            { ...second, build: { ...second.build, output: "/workspace/other-dist" } },
          ])
          .pipe(Effect.flip)
        assert.strictEqual(incompatible.phase, "protocol")
        return completed
      }).pipe(provideLayer(live))
      assert.lengthOf(records, 2)
      assert.strictEqual(yield* Ref.get(starts), 1)
      assert.strictEqual(yield* Ref.get(terminations), 1)
      assert.strictEqual(yield* Ref.get(executions), 2)
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it("bounds retained browser console evidence with deterministic metadata", () => {
    const messages = makeBoundedConsoleCollector(10, 2)
    messages.push("first")
    messages.push("second")
    messages.push("third-message")
    assert.deepEqual(messages.snapshot(), [
      "rd-message",
      "browser console truncated: omittedEntries=3 omittedCharacters=14 retainedCharacters=10",
    ])
  })

  it("rejects oversized browser result payloads before protocol decoding", () => {
    assert.strictEqual(validateBrowserResultPayload("valid"), "valid")
    assert.throws(() => validateBrowserResultPayload("€".repeat(6 * 1024 * 1024)), /exceeds/)
  })

  it("sequences browser observations after retained process sequence numbers", () => {
    const observations = appendBrowserConsoleObservations(
      [
        { sequence: 98, timestampMillis: 1, stream: "stdout", text: "retained tail" },
        { sequence: 99, timestampMillis: 1, stream: "supervisor", text: "truncated" },
      ],
      ["browser one", "browser two"],
      2,
    )
    assert.deepEqual(
      observations.map(({ sequence, text }) => [sequence, text]),
      [
        [98, "retained tail"],
        [99, "truncated"],
        [100, "browser one"],
        [101, "browser two"],
      ],
    )
  })

  it.effect("terminates the server and retains its final output on failure", () =>
    Effect.gen(function* () {
      const output = yield* Ref.make<ReadonlyArray<ProcessObservation>>([])
      const server: RunningProcess = {
        exitCode: Effect.never,
        observations: Ref.get(output),
        terminate: Ref.update(output, (entries) => [
          ...entries,
          {
            sequence: 0,
            timestampMillis: 1,
            stream: "stderr" as const,
            text: "serve shutdown tail",
          },
        ]),
      }
      const failure = yield* withServerFailureEvidence(
        server,
        Effect.fail(
          new WebSupervisorError({
            phase: "browser",
            request,
            cause: new Error("browser failed"),
            observations: [],
          }),
        ),
      ).pipe(Effect.flip)
      assert.strictEqual(failure.phase, "browser")
      assert.deepEqual(
        failure.observations.map(({ stream, text }) => [stream, text]),
        [["stderr", "serve shutdown tail"]],
      )
    }),
  )

  it.effect("retains primary and cleanup failures together with server output", () => {
    const server: RunningProcess = {
      exitCode: Effect.never,
      observations: Effect.succeed<ReadonlyArray<ProcessObservation>>([
        { sequence: 0, timestampMillis: 1, stream: "stderr", text: "bind failed" },
      ]),
      terminate: Effect.fail(
        new ProcessFailure({
          reason: "exit",
          spec: { command: "fake", timeoutMillis: 1_000 },
          observations: [],
          cause: new Error("cleanup failed"),
        }),
      ),
    }
    return withServerFailureEvidence(
      server,
      Effect.fail(
        new WebSupervisorError({
          phase: "protocol",
          request,
          cause: new Error("invalid protocol"),
          observations: [],
        }),
      ),
    ).pipe(
      Effect.flip,
      Effect.tap((failure) =>
        Effect.sync(() => {
          assert.strictEqual(failure.phase, "protocol")
          assert.strictEqual(failure.observations[0]?.text, "bind failed")
          assert(
            typeof failure.cause === "object" &&
              failure.cause !== null &&
              "primary" in failure.cause &&
              "cleanup" in failure.cause,
          )
          assert.match(String(failure.cause.primary), /invalid protocol/)
          assert.match(String(failure.cause.cleanup), /cleanup failed/)
        }),
      ),
    )
  })

  it.effect("retains bounded browser console evidence when browser execution fails", () => {
    const server: RunningProcess = {
      exitCode: Effect.never,
      observations: Effect.succeed<ReadonlyArray<ProcessObservation>>([
        { sequence: 41, timestampMillis: 1, stream: "stderr", text: "server tail" },
      ]),
      terminate: Effect.void,
    }
    return withServerFailureEvidence(
      server,
      Effect.fail(
        new WebSupervisorError({
          phase: "browser",
          request,
          cause: new BrowserDriverError({
            cause: new Error("result element never appeared"),
            console: ["app crashed before rendering", "browser console truncated"],
          }),
          observations: [],
        }),
      ),
    ).pipe(
      Effect.flip,
      Effect.tap((failure) =>
        Effect.sync(() => {
          assert.deepEqual(
            failure.observations.map(({ sequence, stream, text }) => [sequence, stream, text]),
            [
              [41, "stderr", "server tail"],
              [42, "stdout", "app crashed before rendering"],
              [43, "stdout", "browser console truncated"],
            ],
          )
        }),
      ),
    )
  })
})
