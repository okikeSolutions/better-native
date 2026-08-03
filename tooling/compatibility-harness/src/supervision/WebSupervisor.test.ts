import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import { BuildId, ContentHash, type ProcessObservation } from "../Domain.ts"
import { ProcessFailure, type RunningProcess } from "./ProcessSupervisor.ts"
import {
  appendBrowserConsoleObservations,
  BrowserDriverError,
  makeBoundedConsoleCollector,
  validateBrowserResultPayload,
  WebSupervisorError,
  withServerFailureEvidence,
  type WebRunRequest,
} from "./WebSupervisor.ts"

const request: WebRunRequest = {
  id: "web-failure",
  build: {
    record: {
      schemaVersion: 1,
      id: BuildId.make("web-build"),
      mode: "upstream",
      platform: "web",
      expoRevision: "expo-revision",
      candidateRevision: null,
      configurationHash: ContentHash.make("configuration-hash"),
      bundleHash: ContentHash.make("bundle-hash"),
      nativeBinaryHash: null,
      artifacts: [],
    },
    workspace: "/workspace",
    appDirectory: "/workspace/app",
    output: "/workspace/dist",
    expoCli: "/workspace/expo-cli",
    observations: [],
  },
  caseIds: [],
  sourceIds: [],
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
