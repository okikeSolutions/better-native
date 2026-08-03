import { chromium } from "playwright"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import {
  AppRunSummary,
  AttemptId,
  DeviceId,
  RunId,
  RunPlan,
  RunRecord,
  type RunRecord as RunRecordType,
  type CorpusSnapshot,
  type DiscoveryRecord,
  type ProcessObservation,
  type TestCaseId,
  type TestSourceId,
} from "../Domain.ts"
import type { BuildOutput } from "./BuildPipeline.ts"
import { EvidenceStore } from "./EvidenceStore.ts"
import { DiscoveryPass } from "./DiscoveryPass.ts"
import { ProcessSupervisor, type RunningProcess } from "./ProcessSupervisor.ts"
import * as RunProtocol from "./RunProtocol.ts"

export interface WebRunRequest {
  readonly id: string
  readonly build: BuildOutput
  readonly caseIds: ReadonlyArray<TestCaseId>
  readonly sourceIds: ReadonlyArray<TestSourceId>
  readonly port: number
  readonly timeoutMillis: number
  readonly corpus: CorpusSnapshot
}
export interface WebProbeRequest extends Omit<WebRunRequest, "caseIds" | "sourceIds"> {
  readonly specifier: string
}

export class WebSupervisorError extends Data.TaggedError("WebSupervisorError")<{
  readonly phase: "serve" | "browser" | "protocol" | "evidence"
  readonly request: WebRunRequest | WebProbeRequest
  readonly cause: unknown
  readonly observations: ReadonlyArray<ProcessObservation>
}> {}

const webFailure = (
  phase: WebSupervisorError["phase"],
  request: WebRunRequest | WebProbeRequest,
  cause: unknown,
) => new WebSupervisorError({ phase, request, cause, observations: [] })

/** @internal */
export const withServerFailureEvidence = <A>(
  server: RunningProcess,
  effect: Effect.Effect<A, WebSupervisorError>,
): Effect.Effect<A, WebSupervisorError> =>
  effect.pipe(
    Effect.catch((failure) =>
      Effect.gen(function* () {
        const cleanup = yield* Effect.exit(server.terminate)
        const processObservations = yield* server.observations
        const timestampMillis = yield* Clock.currentTimeMillis
        const observations = appendBrowserConsoleObservations(
          processObservations,
          failure.cause instanceof BrowserDriverError ? failure.cause.console : [],
          timestampMillis,
        )
        return yield* new WebSupervisorError({
          phase: failure.phase,
          request: failure.request,
          cause: Exit.isFailure(cleanup)
            ? { primary: failure.cause, cleanup: cleanup.cause }
            : failure.cause,
          observations,
        })
      }),
    ),
  )

export interface BrowserResult {
  readonly resultJson: string
  readonly console: ReadonlyArray<string>
}

export class BrowserDriverError extends Data.TaggedError("BrowserDriverError")<{
  readonly cause: unknown
  readonly console: ReadonlyArray<string>
}> {}

const maximumBrowserConsoleCharacters = 256 * 1024
const maximumBrowserConsoleEntries = 1_000
const maximumBrowserResultBytes = 16 * 1024 * 1024

/** @internal */
export const makeBoundedConsoleCollector = (
  characterLimit = maximumBrowserConsoleCharacters,
  entryLimit = maximumBrowserConsoleEntries,
) => {
  const entries: Array<{ readonly text: string; readonly characters: number }> = []
  let retainedCharacters = 0
  let omittedEntries = 0
  let omittedCharacters = 0
  return {
    push(text: string) {
      const retained = text.length <= characterLimit ? text : text.slice(-characterLimit)
      if (retained.length !== text.length) {
        omittedEntries += 1
        omittedCharacters += text.length - retained.length
      }
      entries.push({ text: retained, characters: retained.length })
      retainedCharacters += retained.length
      while (
        entries.length > 1 &&
        (entries.length > entryLimit || retainedCharacters > characterLimit)
      ) {
        const removed = entries.shift()
        if (removed === undefined) break
        retainedCharacters -= removed.characters
        omittedEntries += 1
        omittedCharacters += removed.characters
      }
    },
    snapshot(): ReadonlyArray<string> {
      const retained = entries.map(({ text }) => text)
      return omittedEntries === 0
        ? retained
        : [
            ...retained,
            `browser console truncated: omittedEntries=${omittedEntries} omittedCharacters=${omittedCharacters} retainedCharacters=${retainedCharacters}`,
          ]
    },
  }
}

/** @internal */
export const validateBrowserResultPayload = (text: string): string => {
  if (text.length > maximumBrowserResultBytes) {
    throw new Error(`browser result exceeds ${maximumBrowserResultBytes} bytes`)
  }
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes > maximumBrowserResultBytes) {
    throw new Error(`browser result exceeds ${maximumBrowserResultBytes} bytes`)
  }
  return text
}

/** @internal */
export const appendBrowserConsoleObservations = (
  processObservations: ReadonlyArray<ProcessObservation>,
  browserConsole: ReadonlyArray<string>,
  timestampMillis: number,
): ReadonlyArray<ProcessObservation> => {
  const firstSequence =
    processObservations.reduce(
      (maximum, observation) => Math.max(maximum, observation.sequence),
      -1,
    ) + 1
  return [
    ...processObservations,
    ...browserConsole.map((text, index) => ({
      sequence: firstSequence + index,
      timestampMillis,
      stream: "stdout" as const,
      text,
    })),
  ]
}

export interface BrowserDriverService {
  readonly execute: (
    url: string,
    timeoutMillis: number,
    resultTestId: string,
  ) => Effect.Effect<BrowserResult, unknown>
}

export class BrowserDriver extends Context.Service<BrowserDriver, BrowserDriverService>()(
  "@better-native/compatibility-harness/BrowserDriver",
) {}

export const browserLayer = Layer.succeed(
  BrowserDriver,
  BrowserDriver.of({
    execute: (url, timeoutMillis, resultTestId) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => chromium.launch({ headless: true }),
          catch: (cause) => new BrowserDriverError({ cause, console: [] }),
        }),
        (browser) =>
          Effect.suspend(() => {
            const messages = makeBoundedConsoleCollector()
            return Effect.tryPromise({
              try: async () => {
                const page = await browser.newPage()
                page.on("console", (message) => messages.push(message.text()))
                await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMillis })
                const result = page.getByTestId(resultTestId)
                await result.waitFor({ state: "visible", timeout: timeoutMillis })
                const resultJson = await result.evaluate((element, byteLimit) => {
                  const text = element.textContent ?? ""
                  if (
                    text.length > byteLimit ||
                    new TextEncoder().encode(text).byteLength > byteLimit
                  ) {
                    throw new Error(`browser result exceeds ${byteLimit} bytes`)
                  }
                  return text
                }, maximumBrowserResultBytes)
                return {
                  resultJson: validateBrowserResultPayload(resultJson),
                  console: messages.snapshot(),
                }
              },
              catch: (cause) => new BrowserDriverError({ cause, console: messages.snapshot() }),
            })
          }),
        (browser) => Effect.promise(() => browser.close()),
      ),
  }),
)

export interface Service {
  readonly run: (request: WebRunRequest) => Effect.Effect<RunRecordType, WebSupervisorError>
  readonly probe: (request: WebProbeRequest) => Effect.Effect<DiscoveryRecord, WebSupervisorError>
}

export class WebSupervisor extends Context.Service<WebSupervisor, Service>()(
  "@better-native/compatibility-harness/WebSupervisor",
) {}

export const layer: Layer.Layer<
  WebSupervisor,
  never,
  BrowserDriver | ProcessSupervisor | EvidenceStore | DiscoveryPass
> = Layer.effect(
  WebSupervisor,
  Effect.gen(function* () {
    const browser = yield* BrowserDriver
    const processes = yield* ProcessSupervisor
    const evidence = yield* EvidenceStore
    const discovery = yield* DiscoveryPass
    const run: Service["run"] = (request) =>
      Effect.scoped(
        Effect.gen(function* () {
          const runId = RunId.make(request.id)
          const startedAtMillis = yield* Clock.currentTimeMillis
          const server = yield* processes
            .start({
              command: "node",
              args: [
                request.build.expoCli,
                "serve",
                request.build.output,
                "--port",
                String(request.port),
              ],
              cwd: request.build.appDirectory,
              timeoutMillis: request.timeoutMillis,
              terminationGraceMillis: 2_000,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new WebSupervisorError({
                    phase: "serve",
                    request,
                    cause,
                    observations: cause.observations,
                  }),
              ),
            )
          return yield* withServerFailureEvidence(
            server,
            Effect.gen(function* () {
              const query = new URLSearchParams({ runId: request.id })
              for (const caseId of request.caseIds) query.append("case", caseId)
              for (const sourceId of request.sourceIds) query.append("source", sourceId)
              const browserResult = yield* browser
                .execute(
                  `http://127.0.0.1:${request.port}/run?${query.toString()}`,
                  request.timeoutMillis,
                  "compatibility_run_result_json",
                )
                .pipe(
                  Effect.retry(Schedule.exponential(100).pipe(Schedule.upTo({ times: 5 }))),
                  Effect.mapError((cause) => webFailure("browser", request, cause)),
                )
              const summary = yield* Effect.try({
                try: () => JSON.parse(browserResult.resultJson) as unknown,
                catch: (cause) => webFailure("protocol", request, cause),
              }).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(AppRunSummary)),
                Effect.mapError((cause) =>
                  cause instanceof WebSupervisorError
                    ? cause
                    : webFailure("protocol", request, cause),
                ),
              )
              yield* RunProtocol.validate(
                {
                  runId: request.id,
                  buildId: request.build.record.id,
                  mode: request.build.record.mode,
                  caseIds: request.caseIds,
                  sourceIds: request.sourceIds,
                },
                summary,
              ).pipe(Effect.mapError((cause) => webFailure("protocol", request, cause)))
              yield* server.terminate.pipe(
                Effect.mapError((cause) => webFailure("serve", request, cause)),
              )
              const finishedAtMillis = yield* Clock.currentTimeMillis
              const processObservations = yield* server.observations
              const observations = appendBrowserConsoleObservations(
                processObservations,
                browserResult.console,
                finishedAtMillis,
              )
              const plan = {
                schemaVersion: 1 as const,
                id: runId,
                buildId: request.build.record.id,
                platform: "web" as const,
                testCases: request.caseIds,
                testSources: request.sourceIds,
                timeoutMillis: request.timeoutMillis,
                retries: 0,
              }
              const infrastructure = RunProtocol.infrastructureOf(summary)
              const record: RunRecordType = {
                schemaVersion: 1,
                plan,
                build: request.build.record,
                device: {
                  id: DeviceId.make(`chromium-${request.port}`),
                  platform: "web",
                  kind: "browser",
                  name: "Playwright Chromium",
                  osVersion: null,
                  runtimeVersion: chromium.name(),
                },
                runtimeDiscoveredCaseIds: summary.runtimeDiscoveredCaseIds,
                attempts: [
                  {
                    schemaVersion: 1,
                    id: AttemptId.make(`${request.id}-1`),
                    runId,
                    attempt: 1,
                    startedAtMillis,
                    finishedAtMillis,
                    infrastructure,
                    results: summary.results,
                    observations,
                    artifacts: [],
                  },
                ],
                finalInfrastructure: infrastructure,
              }
              yield* Schema.decodeUnknownEffect(RunPlan)(plan).pipe(
                Effect.mapError((cause) => webFailure("protocol", request, cause)),
              )
              yield* evidence
                .writeJson("runs", request.id, "record.json", RunRecord, record)
                .pipe(Effect.mapError((cause) => webFailure("evidence", request, cause)))
              yield* discovery
                .collect({
                  runId,
                  buildId: request.build.record.id,
                  mode: request.build.record.mode,
                  platform: "web",
                  corpus: request.corpus,
                  summaries: [summary],
                  processObservations: request.build.observations,
                  exportProbeJson: [],
                })
                .pipe(Effect.mapError((cause) => webFailure("evidence", request, cause)))
              return record
            }),
          )
        }),
      )
    const probe: Service["probe"] = (request) =>
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* processes
            .start({
              command: "node",
              args: [
                request.build.expoCli,
                "serve",
                request.build.output,
                "--port",
                String(request.port),
              ],
              cwd: request.build.appDirectory,
              timeoutMillis: request.timeoutMillis,
              terminationGraceMillis: 2_000,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new WebSupervisorError({
                    phase: "serve",
                    request,
                    cause,
                    observations: cause.observations,
                  }),
              ),
            )
          return yield* withServerFailureEvidence(
            server,
            Effect.gen(function* () {
              const query = new URLSearchParams({ specifier: request.specifier })
              const browserResult = yield* browser
                .execute(
                  `http://127.0.0.1:${request.port}/discover?${query.toString()}`,
                  request.timeoutMillis,
                  "compatibility_discovery_result_json",
                )
                .pipe(
                  Effect.retry(Schedule.exponential(100).pipe(Schedule.upTo({ times: 5 }))),
                  Effect.mapError((cause) => webFailure("browser", request, cause)),
                )
              yield* server.terminate.pipe(
                Effect.mapError((cause) => webFailure("serve", request, cause)),
              )
              return yield* discovery
                .collect({
                  runId: RunId.make(request.id),
                  buildId: request.build.record.id,
                  mode: request.build.record.mode,
                  platform: "web",
                  corpus: request.corpus,
                  summaries: [],
                  processObservations: request.build.observations,
                  exportProbeJson: [browserResult.resultJson],
                })
                .pipe(Effect.mapError((cause) => webFailure("evidence", request, cause)))
            }),
          )
        }),
      )
    return WebSupervisor.of({ run, probe })
  }),
)
