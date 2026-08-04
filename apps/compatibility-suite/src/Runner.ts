import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
// Expo's pinned in-app suite uses this Jasmine browser core entrypoint without declarations.
// @ts-expect-error -- compatibility adapter for the pinned upstream runner.
import jasmineRequire from "jasmine-core/lib/jasmine-core/jasmine"
import { CompatibilityConfiguration } from "./Configuration.ts"
import {
  nativeE2eSourceIds,
  registry,
  type ExpoTestModule,
  type RegistryEntry,
  type TestTools,
} from "./Registry.ts"

/** The only execution data accepted over a deep link or browser URL. */
const RunSelection = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: Schema.NonEmptyString,
  sourceId: Schema.NonEmptyString,
})
const NativeE2eSelection = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: Schema.NonEmptyString,
  cohort: Schema.Literal("native-e2e"),
})
const AnyRunSelection = Schema.Union([RunSelection, NativeE2eSelection])
const Passed = Schema.TaggedStruct("passed", { durationMillis: Schema.Number })
const Failed = Schema.TaggedStruct("failed", {
  durationMillis: Schema.Number,
  message: Schema.String,
  stack: Schema.NullOr(Schema.String),
})
const Skipped = Schema.TaggedStruct("skipped", { reason: Schema.String })
const NotRun = Schema.TaggedStruct("not-run", { reason: Schema.String })
const CaseResult = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: Schema.String,
  caseId: Schema.String,
  attempt: Schema.Int,
  outcome: Schema.Union([Passed, Failed, Skipped, NotRun]),
  artifacts: Schema.Array(Schema.String),
})
const RunSummary = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: Schema.String,
  buildId: Schema.String,
  mode: Schema.Literals(["upstream", "candidate"]),
  results: Schema.Array(CaseResult),
  runtimeDiscoveredCaseIds: Schema.Array(Schema.String),
})

export type RunSelection = Schema.Schema.Type<typeof AnyRunSelection>
export type RunSummary = Schema.Schema.Type<typeof RunSummary>
export type CaseResult = Schema.Schema.Type<typeof CaseResult>

export class RunSelectionError extends Data.TaggedError("RunSelectionError")<{
  readonly reason: string
}> {}

const isExpoTestModule = (value: unknown): value is ExpoTestModule =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string" &&
  "test" in value &&
  typeof value.test === "function"

const moduleOf = (value: unknown): ExpoTestModule | null => (isExpoTestModule(value) ? value : null)

const staticCaseName = (sourceId: string, caseId: string): string =>
  caseId.slice(`${sourceId}#`.length).replace(/@\d+$/, "")

const jasmineCaseName = (name: string): string => name.replaceAll(" > ", " ")

interface JasmineSpec {
  readonly id: string
  readonly getFullName: () => string
}

const JasmineDone = Schema.Struct({
  overallStatus: Schema.optional(Schema.String),
  incompleteReason: Schema.optional(Schema.String),
  failedExpectations: Schema.optional(
    Schema.Array(
      Schema.Struct({
        message: Schema.optional(Schema.String),
        stack: Schema.optional(Schema.String),
      }),
    ),
  ),
})

const wrapSpec = (assertion: (...args: ReadonlyArray<unknown>) => unknown) => () => assertion()

// Match Expo's in-app TestScreen runner: React Native owns global error handling,
// while an individual Jasmine environment must not replace it for each source.
class NoopGlobalErrors {
  install() {}
  uninstall() {}
  pushListener() {}
  popListener() {}
  setOverrideListener() {}
  removeOverrideListener() {}
  reportUnhandledRejections() {}
}

const failed = (runId: string, caseId: string, cause: unknown): CaseResult => ({
  schemaVersion: 1,
  runId,
  caseId,
  attempt: 1,
  outcome: {
    _tag: "failed",
    durationMillis: 0,
    message: cause instanceof Error ? cause.message : String(cause),
    stack: cause instanceof Error ? (cause.stack ?? null) : null,
  },
  artifacts: [],
})

const notRun = (runId: string, caseId: string, reason: string): CaseResult => ({
  schemaVersion: 1,
  runId,
  caseId,
  attempt: 1,
  outcome: { _tag: "not-run", reason },
  artifacts: [],
})

const skipped = (runId: string, caseId: string, reason: string): CaseResult => ({
  schemaVersion: 1,
  runId,
  caseId,
  attempt: 1,
  outcome: { _tag: "skipped", reason },
  artifacts: [],
})

const runSource = (
  selection: RunSelection,
  source: RegistryEntry,
  selectedCaseIds: ReadonlySet<string>,
  discovery: boolean,
  tools: TestTools,
) =>
  Effect.tryPromise({
    try: async () => {
      if (!source.selectedByUpstream) {
        const caseIds =
          selectedCaseIds.size > 0
            ? [...selectedCaseIds]
            : [`${source.sourceId}#<not-applicable>@1`]
        return {
          results: caseIds.map((caseId) =>
            skipped(selection.runId, caseId, "not selected by pinned Expo TestModules.ts"),
          ),
          runtimeDiscoveredCaseIds:
            selectedCaseIds.size === 0 ? [`${source.sourceId}#<not-applicable>@1`] : [],
        }
      }
      if (source.load === null) {
        return {
          results: [...selectedCaseIds].map((caseId) =>
            notRun(
              selection.runId,
              caseId,
              source.reason ?? "source is external to the application",
            ),
          ),
          runtimeDiscoveredCaseIds: [],
        }
      }
      let loaded: unknown
      try {
        loaded = source.load()
      } catch (cause) {
        return {
          results: [...selectedCaseIds].map((caseId) => failed(selection.runId, caseId, cause)),
          runtimeDiscoveredCaseIds: [],
        }
      }
      const testModule = moduleOf(loaded)
      if (testModule === null) {
        return {
          results: [...selectedCaseIds].map((caseId) =>
            failed(
              selection.runId,
              caseId,
              new Error(`${source.sourceId} is not an Expo Jasmine module`),
            ),
          ),
          runtimeDiscoveredCaseIds: [],
        }
      }

      const jasmineCore = jasmineRequire.core(jasmineRequire)
      const jasmineEnv = jasmineCore.getEnv({
        suppressLoadErrors: true,
        GlobalErrors: NoopGlobalErrors,
      })
      const staticCaseIds = new Map<string, string>(
        source.caseIds.map((caseId) => {
          const occurrence = caseId.match(/@(\d+)$/)?.[1] ?? "1"
          return [
            `${jasmineCaseName(staticCaseName(source.sourceId, caseId))}@${occurrence}`,
            caseId,
          ] as const
        }),
      )
      const registrationOccurrences = new Map<string, number>()
      const caseIdBySpecId = new Map<string, string>()
      jasmineEnv.configure({
        random: false,
        specFilter: (spec: JasmineSpec) => {
          const name = jasmineCaseName(spec.getFullName())
          const occurrence = (registrationOccurrences.get(name) ?? 0) + 1
          registrationOccurrences.set(name, occurrence)
          const caseId = staticCaseIds.get(`${name}@${occurrence}`)
          if (caseId !== undefined) caseIdBySpecId.set(spec.id, caseId)
          return discovery || (caseId !== undefined && selectedCaseIds.has(caseId))
        },
      })
      const results: Array<CaseResult> = []
      const runtimeDiscoveredCaseIds: Array<string> = []
      const occurrences = new Map<string, number>()
      const knownCaseIds = new Set<string>(source.caseIds)
      jasmineEnv.addReporter({
        specDone(result: {
          id: string
          fullName: string
          status: string
          duration?: number
          failedExpectations: ReadonlyArray<{ message: string; stack?: string }>
        }) {
          const name = jasmineCaseName(result.fullName)
          const occurrence = (occurrences.get(name) ?? 0) + 1
          occurrences.set(name, occurrence)
          const discoveredCaseId = `${source.sourceId}#${name}@${occurrence}`
          const caseId = caseIdBySpecId.get(result.id) ?? discoveredCaseId
          if (result.status === "excluded" && !selectedCaseIds.has(caseId) && !discovery) return
          if (discovery) {
            runtimeDiscoveredCaseIds.push(caseId)
          } else if (!knownCaseIds.has(caseId)) {
            runtimeDiscoveredCaseIds.push(discoveredCaseId)
          }
          const durationMillis = result.duration ?? 0
          const outcome = Match.value(result.status).pipe(
            Match.when("passed", () => ({ _tag: "passed" as const, durationMillis })),
            Match.when("failed", () => ({
              _tag: "failed" as const,
              durationMillis,
              message: result.failedExpectations.map(({ message }) => message).join("\n"),
              stack: result.failedExpectations[0]?.stack ?? null,
            })),
            Match.orElse(() => ({ _tag: "skipped" as const, reason: result.status })),
          )
          results.push({
            schemaVersion: 1,
            runId: selection.runId,
            caseId,
            attempt: 1,
            outcome,
            artifacts: [],
          })
        },
      })
      const jasmine = jasmineRequire.interface(jasmineCore, jasmineEnv)
      jasmine.jasmine.DEFAULT_TIMEOUT_INTERVAL = 10_000
      let registeredSpecCount = 0
      for (const key of ["it", "xit", "fit"] as const) {
        const original = jasmine[key]
        jasmine[key] = (
          description: string,
          assertion: (...args: ReadonlyArray<unknown>) => unknown,
          timeout?: number,
        ) => {
          const spec = original(description, wrapSpec(assertion), timeout)
          registeredSpecCount += 1
          return spec
        }
      }
      const platformSkipped = () => {
        const caseIds =
          selectedCaseIds.size > 0
            ? [...selectedCaseIds]
            : [`${source.sourceId}#<not-applicable>@1`]
        return {
          results: caseIds.map((caseId) =>
            skipped(selection.runId, caseId, "source registered no cases for this platform"),
          ),
          runtimeDiscoveredCaseIds: selectedCaseIds.size === 0 ? caseIds : [],
        }
      }
      try {
        await testModule.test(jasmine, tools)
      } catch (cause) {
        if (
          registeredSpecCount === 0 &&
          cause instanceof Error &&
          cause.message.startsWith("describe with no children (describe() or it())")
        ) {
          return platformSkipped()
        }
        const caseIds =
          selectedCaseIds.size > 0
            ? [...selectedCaseIds]
            : [`${source.sourceId}#<registration failure>@1`]
        return {
          results: caseIds.map((caseId) => failed(selection.runId, caseId, cause)),
          runtimeDiscoveredCaseIds: selectedCaseIds.size === 0 ? caseIds : [],
        }
      }
      if (registeredSpecCount === 0) return platformSkipped()
      const done = Schema.decodeUnknownSync(JasmineDone)(await jasmineEnv.execute())
      if (
        done.overallStatus !== "passed" &&
        !results.some(({ outcome }) => outcome._tag === "failed")
      ) {
        const detail =
          done.failedExpectations?.find(({ message }) => message !== undefined)?.message ??
          done.incompleteReason ??
          `Jasmine completed with status ${done.overallStatus ?? "unknown"}`
        const first = results[0]
        if (first !== undefined) {
          results[0] = failed(selection.runId, first.caseId, new Error(detail))
        } else {
          const selected = [...selectedCaseIds][0]
          const caseId = selected ?? `${source.sourceId}#<suite failure>@1`
          results.push(failed(selection.runId, caseId, new Error(detail)))
          if (selected === undefined) runtimeDiscoveredCaseIds.push(caseId)
        }
      }
      if (!discovery) {
        const observed = new Set(results.map(({ caseId }) => caseId))
        for (const caseId of selectedCaseIds) {
          if (!observed.has(caseId)) {
            results.push(notRun(selection.runId, caseId, "case was not registered at runtime"))
          }
        }
      }
      return { results, runtimeDiscoveredCaseIds }
    },
    catch: (cause) =>
      new RunSelectionError({ reason: `execute ${source.sourceId}: ${String(cause)}` }),
  })

const decodeRunSelectionWith = (entries: ReadonlyArray<RegistryEntry>, input: unknown) =>
  Schema.decodeUnknownEffect(AnyRunSelection)(input).pipe(
    Effect.mapError((cause) => new RunSelectionError({ reason: String(cause) })),
    Effect.flatMap((selection) =>
      "cohort" in selection || entries.some((entry) => entry.sourceId === selection.sourceId)
        ? Effect.succeed(selection)
        : Effect.fail(
            new RunSelectionError({ reason: `unknown source ID: ${selection.sourceId}` }),
          ),
    ),
  )

export const make = (entries: ReadonlyArray<RegistryEntry>) => {
  const decodeRunSelection = (input: unknown) => decodeRunSelectionWith(entries, input)
  const run = Effect.fn("CompatibilityRunner.run")(function* (input: unknown, tools: TestTools) {
    const selection = yield* decodeRunSelection(input)
    const configuration = yield* CompatibilityConfiguration
    const selectedEntries =
      "cohort" in selection
        ? entries.filter(({ sourceId }) => nativeE2eSourceIds.has(sourceId))
        : entries.filter((entry) => entry.sourceId === selection.sourceId)
    if (selectedEntries.length === 0) {
      return yield* new RunSelectionError({
        reason:
          "cohort" in selection
            ? "the pinned Expo native E2E cohort is empty"
            : `unknown source ID: ${selection.sourceId}`,
      })
    }
    const groups = yield* Effect.forEach(selectedEntries, (entry) =>
      runSource(selection, entry, new Set(entry.caseIds), true, tools),
    )
    const summary = yield* Schema.decodeUnknownEffect(RunSummary)({
      schemaVersion: 1,
      runId: selection.runId,
      buildId: configuration.buildId,
      mode: configuration.mode,
      results: groups.flatMap(({ results }) => results),
      runtimeDiscoveredCaseIds: groups.flatMap(
        ({ runtimeDiscoveredCaseIds }) => runtimeDiscoveredCaseIds,
      ),
    })
    yield* Effect.sync(() => console.log(`BETTER_NATIVE_RESULT_V1=${JSON.stringify(summary)}`))
    return summary
  })
  return { decodeRunSelection, run } as const
}

const live = make(registry)
export const run = live.run
