import { chromium, type Browser } from "playwright"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import {
  AppRunSummary,
  AttemptId,
  DeviceId,
  RunId,
  RunPlan,
  RunRecord,
  ProcessObservation as ProcessObservationSchema,
  type RunRecord as RunRecordType,
  type CorpusSnapshot,
  type DiscoveryRecord,
  type ProcessObservation,
  type ExecutionUnit,
  type RunPlan as RunPlanType,
} from "../Domain.ts"
import type { BuildOutput } from "../build/BuildPipeline.ts"
import { DiscoveryPass } from "../evidence/DiscoveryPass.ts"
import { EvidenceStore, type Service as EvidenceStoreService } from "../evidence/EvidenceStore.ts"
import { ProcessSupervisor, type RunningProcess } from "./ProcessSupervisor.ts"
import * as RunProtocol from "../protocol/RunProtocol.ts"

/** Request for one browser execution against a prepared web build. */
export interface WebRunRequest {
  readonly id: RunId
  readonly build: BuildOutput
  readonly unit: ExecutionUnit
  readonly port: number
  readonly timeoutMillis: number
  readonly corpus: CorpusSnapshot
}
/** Request for one isolated browser module-resolution probe. */
export interface WebProbeRequest extends Omit<WebRunRequest, "unit"> {
  readonly specifier: string
}

/** Failure raised while serving, driving, validating, or recording a web run. */
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

/**
 * Converts a web-run failure into evidence while preserving server observations.
 *
 * @remarks
 * Cleanup is attempted before the failure is returned. If cleanup also fails,
 * both causes remain visible in the resulting error.
 *
 * @param server - Running web server associated with the browser run.
 * @param effect - Browser operation whose failure should be enriched.
 * @returns The original effect with server observations attached on failure.
 */
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

/** Browser payload and console output returned by the page harness. */
export interface BrowserResult {
  readonly resultJson: string
  readonly console: ReadonlyArray<string>
}

/** Failure raised by Playwright, including captured browser console output. */
export class BrowserDriverError extends Data.TaggedError("BrowserDriverError")<{
  readonly cause: unknown
  readonly console: ReadonlyArray<string>
}> {}

const WebRunFailure = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  plan: RunPlan,
  phase: Schema.Literals(["serve", "browser", "protocol", "evidence"]),
  message: Schema.String,
  observations: Schema.Array(ProcessObservationSchema),
})

/**
 * Produces a bounded, useful message from nested Effect and process failures.
 *
 * @param value - Unknown failure value to render.
 * @param depth - Current recursion depth used to prevent pathological causes.
 * @returns A concise diagnostic string.
 */
export const diagnosticMessage = (value: unknown, depth = 0): string => {
  if (depth >= 4) return String(value)
  if (typeof value === "object" && value !== null) {
    const tag = "_tag" in value ? String(Reflect.get(value, "_tag")) : null
    const reason = "reason" in value ? Reflect.get(value, "reason") : undefined
    if (typeof reason === "string") return tag === null ? reason : `${tag}: ${reason}`
    const cause = "cause" in value ? Reflect.get(value, "cause") : undefined
    if (cause !== undefined) {
      const detail = diagnosticMessage(cause, depth + 1)
      return tag === null ? detail : `${tag}: ${detail}`
    }
  }
  return value instanceof Error ? `${value.name}: ${value.message}` : String(value)
}

/**
 * Persists a structured web failure and its bounded process observations.
 *
 * @param evidence - Shared immutable evidence store.
 * @param requestId - Safe run identifier used as the evidence directory.
 * @param plan - Run plan that was active when the failure occurred.
 * @param failure - Failure containing phase and captured observations.
 * @returns The written failure artifact.
 */
export const persistWebRunFailure = (
  evidence: EvidenceStoreService,
  requestId: string,
  plan: RunPlanType,
  failure: WebSupervisorError,
) =>
  evidence.writeJson("runs", requestId, "failure.json", WebRunFailure, {
    schemaVersion: 1,
    plan,
    phase: failure.phase,
    message: diagnosticMessage(failure.cause),
    observations: failure.observations,
  })

const maximumBrowserConsoleCharacters = 256 * 1024
const maximumBrowserConsoleEntries = 1_000
const maximumBrowserResultBytes = 16 * 1024 * 1024
const browserReadinessTimeoutMillis = 60_000
/**
 * Builds the minimal deep link used to select one web compatibility source.
 *
 * @param port - Local web server port.
 * @param runId - Supervised run identifier.
 * @param sourceId - Static registry source identifier.
 * @returns URL passed to the browser driver.
 */
export const webRunUrl = (port: number, runId: string, sourceId: string): string =>
  `http://127.0.0.1:${port}/run?${new URLSearchParams({ runId, source: sourceId }).toString()}`

/**
 * Creates a bounded browser-console collector for one page session.
 *
 * @remarks
 * Both entry count and encoded character count are bounded so a noisy page
 * cannot exhaust supervisor memory before the run result is returned.
 *
 * @param characterLimit - Maximum retained characters across entries.
 * @param entryLimit - Maximum retained console entries.
 * @returns A collector callback and a snapshot function for captured messages.
 */
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

/**
 * Validates and extracts the result payload emitted by the browser app.
 *
 * @param text - Raw page text returned by the browser driver.
 * @returns The encoded application result JSON.
 * @throws When the sentinel or payload is missing or malformed.
 */
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

/**
 * Appends browser console entries to bounded process observations.
 *
 * @param processObservations - Existing supervisor observations.
 * @param browserConsole - Browser messages captured during the run.
 * @param timestampMillis - Timestamp assigned to appended entries.
 * @returns Combined observations in sequence order.
 */
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

/** Browser automation operations used by the web supervisor. */
export interface BrowserDriverService {
  readonly execute: (
    url: string,
    timeoutMillis: number,
    resultTestId: string,
    permissions?: ReadonlyArray<string>,
  ) => Effect.Effect<BrowserResult, unknown>
}

/** Effect context tag for the Playwright browser driver. */
export class BrowserDriver extends Context.Service<BrowserDriver, BrowserDriverService>()(
  "@better-native/compatibility-harness/BrowserDriver",
) {}

const clipboardSourceId = "expo-app-suite#apps/test-suite/tests/Clipboard.js"
const keepAwakeSourceId = "expo-app-suite#apps/test-suite/tests/KeepAwake.js"
const keepAwakeCapabilitySourceId =
  "better-native-capability#apps/compatibility-suite/src/capabilities/KeepAwake.ts"

/**
 * Returns browser permissions required by one known Expo source.
 *
 * @param sourceId - Static registry source identifier.
 * @returns Permission names to grant before the browser run.
 */
export const browserPermissionsForSource = (sourceId: string): ReadonlyArray<string> =>
  Match.value(sourceId).pipe(
    Match.when(clipboardSourceId, () => ["clipboard-read", "clipboard-write"]),
    Match.whenOr(keepAwakeSourceId, keepAwakeCapabilitySourceId, () => ["screen-wake-lock"]),
    Match.orElse(() => []),
  )

/**
 * Builds the Playwright driver with the harness browser policy.
 *
 * @remarks
 * One headless browser is shared within the layer scope; every execution gets an
 * isolated context that is closed before returning.
 *
 * @returns A scoped layer providing {@link BrowserDriver}.
 */
export const browserLayer = Layer.effect(
  BrowserDriver,
  Effect.gen(function* () {
    let browserPromise: Promise<Browser> | undefined
    const browser = () => {
      browserPromise ??= chromium.launch({ headless: true })
      return browserPromise
    }
    yield* Effect.addFinalizer(() => {
      const pendingBrowser = browserPromise
      return pendingBrowser === undefined
        ? Effect.void
        : Effect.promise(async () => {
            const launched = await pendingBrowser
            await launched.close()
          })
    })
    return BrowserDriver.of({
      execute: (url, timeoutMillis, resultTestId, permissions = []) =>
        Effect.suspend(() => {
          const messages = makeBoundedConsoleCollector()
          return Effect.tryPromise({
            try: async () => {
              const launched = await browser()
              const context = await launched.newContext()
              try {
                if (permissions.length > 0) {
                  await context.grantPermissions([...permissions], { origin: new URL(url).origin })
                }
                const page = await context.newPage()
                page.on("console", (message) => messages.push(message.text()))
                page.on("pageerror", (error) => messages.push(`page error: ${error.message}`))
                const response = await page.goto(url, {
                  waitUntil: "domcontentloaded",
                  timeout: Math.min(timeoutMillis, browserReadinessTimeoutMillis),
                })
                if (response !== null && !response.ok()) {
                  throw new Error(
                    `web route returned HTTP ${response.status()} ${response.statusText()}`,
                  )
                }
                const result = page.getByTestId(resultTestId)
                const failure = page.getByTestId("compatibility_run_error")
                const completed = await Promise.race([
                  result.waitFor({ state: "visible", timeout: timeoutMillis }).then(() => "result"),
                  failure
                    .waitFor({ state: "visible", timeout: timeoutMillis })
                    .then(() => "failure"),
                ])
                if (completed === "failure") {
                  throw new Error(`compatibility app failed: ${await failure.textContent()}`)
                }
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
              } finally {
                await context.close()
              }
            },
            catch: (cause) => new BrowserDriverError({ cause, console: messages.snapshot() }),
          })
        }),
    })
  }),
)

/** Web supervision operations for runs and resolution probes. */
export interface Service {
  readonly run: (request: WebRunRequest) => Effect.Effect<RunRecordType, WebSupervisorError>
  readonly runAll: (
    requests: ReadonlyArray<WebRunRequest>,
  ) => Effect.Effect<ReadonlyArray<RunRecordType>, WebSupervisorError>
  readonly probe: (request: WebProbeRequest) => Effect.Effect<DiscoveryRecord, WebSupervisorError>
}

/** Effect context tag for web compatibility supervision. */
export class WebSupervisor extends Context.Service<WebSupervisor, Service>()(
  "@better-native/compatibility-harness/WebSupervisor",
) {}

/**
 * Builds web supervision from process, browser, discovery, and evidence services.
 *
 * @returns A layer providing {@link WebSupervisor}.
 */
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
    const runAgainstServer = (request: WebRunRequest, server: RunningProcess) =>
      Effect.gen(function* () {
        const runId = RunId.make(request.id)
        const startedAtMillis = yield* Clock.currentTimeMillis
        const plan = {
          schemaVersion: 1 as const,
          id: runId,
          buildId: request.build.record.id,
          platform: "web" as const,
          unit: request.unit,
          timeoutMillis: request.timeoutMillis,
          retries: 0,
        }
        const planArtifact = yield* evidence
          .writeJson("runs", request.id, "plan.json", RunPlan, plan)
          .pipe(Effect.mapError((cause) => webFailure("evidence", request, cause)))
        return yield* withServerFailureEvidence(
          server,
          Effect.gen(function* () {
            const browserResult = yield* browser
              .execute(
                webRunUrl(request.port, request.id, request.unit.sourceId),
                request.timeoutMillis,
                "compatibility_run_result_json",
                browserPermissionsForSource(request.unit.sourceId),
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
                sourceId: request.unit.sourceId,
              },
              summary,
            ).pipe(Effect.mapError((cause) => webFailure("protocol", request, cause)))
            const finishedAtMillis = yield* Clock.currentTimeMillis
            const processObservations = yield* server.observations
            const observations = appendBrowserConsoleObservations(
              processObservations,
              browserResult.console,
              finishedAtMillis,
            )
            const infrastructure = RunProtocol.completedInfrastructure()
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
                  artifacts: [planArtifact.id],
                },
              ],
              finalInfrastructure: infrastructure,
            }
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
        ).pipe(
          Effect.catch((failure) =>
            Effect.gen(function* () {
              yield* persistWebRunFailure(evidence, request.id, plan, failure).pipe(
                Effect.mapError(
                  (cause) =>
                    new WebSupervisorError({
                      phase: "evidence",
                      request,
                      cause: { primary: failure, evidence: cause },
                      observations: failure.observations,
                    }),
                ),
              )
              return yield* failure
            }),
          ),
        )
      })
    const runAll: Service["runAll"] = (requests) => {
      const first = requests[0]
      if (first === undefined) return Effect.succeed([])
      const incompatible = requests.find(
        (request) =>
          request.build.record.id !== first.build.record.id ||
          request.build.output !== first.build.output ||
          request.build.appDirectory !== first.build.appDirectory,
      )
      if (incompatible !== undefined) {
        return Effect.fail(
          webFailure(
            "protocol",
            incompatible,
            new Error("a shared web session must reference one build materialization"),
          ),
        )
      }
      return Effect.scoped(
        Effect.gen(function* () {
          const server = yield* processes
            .start({
              command: "node",
              args: [
                first.build.expoCli,
                "serve",
                first.build.output,
                "--port",
                String(first.port),
              ],
              cwd: first.build.appDirectory,
              timeoutMillis: first.timeoutMillis,
              terminationGraceMillis: 2_000,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new WebSupervisorError({
                    phase: "serve",
                    request: first,
                    cause,
                    observations: cause.observations,
                  }),
              ),
            )
          const records = yield* Effect.forEach(requests, (request) =>
            runAgainstServer({ ...request, port: first.port }, server),
          )
          yield* server.terminate.pipe(
            Effect.mapError((cause) => webFailure("serve", first, cause)),
          )
          return records
        }),
      )
    }
    const run: Service["run"] = (request) =>
      runAll([request]).pipe(
        Effect.flatMap((records) => {
          const record = records[0]
          return record === undefined
            ? Effect.fail(webFailure("protocol", request, new Error("web run produced no record")))
            : Effect.succeed(record)
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
    return WebSupervisor.of({ run, runAll, probe })
  }),
)
