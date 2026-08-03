import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
// Expo's pinned in-app suite uses this Jasmine browser core entrypoint without declarations.
// @ts-expect-error -- compatibility adapter for the pinned upstream runner.
import jasmineRequire from "jasmine-core/lib/jasmine-core/jasmine"
import { CompatibilityConfiguration } from "./Configuration.ts"
import { registry, type ExpoTestModule, type RegistryEntry, type TestTools } from "./Registry.ts"

const RunPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: Schema.NonEmptyString,
  caseIds: Schema.Array(Schema.String),
  sourceIds: Schema.optional(Schema.Array(Schema.String)),
})
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

export type RunPlan = Schema.Schema.Type<typeof RunPlan>
export type RunSummary = Schema.Schema.Type<typeof RunSummary>
export type CaseResult = Schema.Schema.Type<typeof CaseResult>

export class RunPlanError extends Data.TaggedError("RunPlanError")<{
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
  plan: RunPlan,
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
            skipped(plan.runId, caseId, "not selected by pinned Expo TestModules.ts"),
          ),
          runtimeDiscoveredCaseIds:
            selectedCaseIds.size === 0 ? [`${source.sourceId}#<not-applicable>@1`] : [],
        }
      }
      if (source.load === null) {
        return {
          results: [...selectedCaseIds].map((caseId) =>
            notRun(plan.runId, caseId, source.reason ?? "source is external to the application"),
          ),
          runtimeDiscoveredCaseIds: [],
        }
      }
      let loaded: unknown
      try {
        loaded = source.load()
      } catch (cause) {
        return {
          results: [...selectedCaseIds].map((caseId) => failed(plan.runId, caseId, cause)),
          runtimeDiscoveredCaseIds: [],
        }
      }
      const testModule = moduleOf(loaded)
      if (testModule === null) {
        return {
          results: [...selectedCaseIds].map((caseId) =>
            failed(
              plan.runId,
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
          if (!knownCaseIds.has(caseId)) {
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
            runId: plan.runId,
            caseId,
            attempt: 1,
            outcome,
            artifacts: [],
          })
        },
      })
      const jasmine = jasmineRequire.interface(jasmineCore, jasmineEnv)
      jasmine.jasmine.DEFAULT_TIMEOUT_INTERVAL = 10_000
      for (const key of ["it", "xit", "fit"] as const) {
        const original = jasmine[key]
        jasmine[key] = (
          description: string,
          assertion: (...args: ReadonlyArray<unknown>) => unknown,
          timeout?: number,
        ) => original(description, wrapSpec(assertion), timeout)
      }
      await testModule.test(jasmine, tools)
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
          results[0] = failed(plan.runId, first.caseId, new Error(detail))
        } else {
          const selected = [...selectedCaseIds][0]
          const caseId = selected ?? `${source.sourceId}#<suite failure>@1`
          results.push(failed(plan.runId, caseId, new Error(detail)))
          if (selected === undefined) runtimeDiscoveredCaseIds.push(caseId)
        }
      }
      const observed = new Set(results.map(({ caseId }) => caseId))
      for (const caseId of selectedCaseIds) {
        if (!observed.has(caseId)) {
          results.push(notRun(plan.runId, caseId, "case was not registered at runtime"))
        }
      }
      return { results, runtimeDiscoveredCaseIds }
    },
    catch: (cause) => new RunPlanError({ reason: `execute ${source.sourceId}: ${String(cause)}` }),
  })

const decodeRunPlanWith = (entries: ReadonlyArray<RegistryEntry>, input: unknown) =>
  Schema.decodeUnknownEffect(RunPlan)(input).pipe(
    Effect.mapError((cause) => new RunPlanError({ reason: String(cause) })),
    Effect.flatMap((plan) => {
      const unique = new Set(plan.caseIds)
      if (unique.size !== plan.caseIds.length) {
        return Effect.fail(new RunPlanError({ reason: "run plan contains duplicate case IDs" }))
      }
      const known = new Set(entries.flatMap(({ caseIds }) => caseIds))
      const missing = plan.caseIds.filter((caseId) => !known.has(caseId))
      if (missing.length > 0) {
        return Effect.fail(new RunPlanError({ reason: `unknown case IDs: ${missing.join(", ")}` }))
      }
      const knownSources = new Set(entries.map(({ sourceId }) => sourceId))
      const missingSources = (plan.sourceIds ?? []).filter(
        (sourceId) => !knownSources.has(sourceId),
      )
      return missingSources.length === 0
        ? Effect.succeed(plan)
        : Effect.fail(
            new RunPlanError({ reason: `unknown source IDs: ${missingSources.join(", ")}` }),
          )
    }),
  )

export const make = (entries: ReadonlyArray<RegistryEntry>) => {
  const decodeRunPlan = (input: unknown) => decodeRunPlanWith(entries, input)
  const run = Effect.fn("CompatibilityRunner.run")(function* (input: unknown, tools: TestTools) {
    const plan = yield* decodeRunPlan(input)
    const configuration = yield* CompatibilityConfiguration
    const selected = new Set(plan.caseIds)
    const discoverySources = new Set(plan.sourceIds ?? [])
    const sources = entries.filter(
      (source) =>
        discoverySources.has(source.sourceId) ||
        source.caseIds.some((caseId) => selected.has(caseId)),
    )
    const groups = yield* Effect.forEach(sources, (source) => {
      const sourceCases = new Set(source.caseIds.filter((caseId) => selected.has(caseId)))
      return runSource(plan, source, sourceCases, discoverySources.has(source.sourceId), tools)
    })
    const summary = yield* Schema.decodeUnknownEffect(RunSummary)({
      schemaVersion: 1,
      runId: plan.runId,
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
  return { decodeRunPlan, run } as const
}

const live = make(registry)
export const run = live.run
