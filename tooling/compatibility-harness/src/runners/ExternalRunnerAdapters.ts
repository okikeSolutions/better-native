import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import { parseStringPromise } from "xml2js"
import { TestCaseId, type CaseResult, type RunId, type TestSourceId } from "../Domain.ts"
import type { ProcessSpec } from "../supervision/ProcessSupervisor.ts"

/** Failure raised when an external runner report cannot be parsed or normalized. */
export class RunnerOutputError extends Data.TaggedError("RunnerOutputError")<{
  readonly runner:
    | "jest"
    | "node-test"
    | "bun-test"
    | "xctest"
    | "gradle-unit"
    | "gradle-instrumentation"
    | "maestro"
    | "playwright"
    | "detox"
    | "workflow"
  readonly cause: unknown
}> {}

/**
 * Builds the bounded Jest command used by reviewed runner plans.
 *
 * @param cwd - Owning Expo workspace directory.
 * @param outputFile - JSON report destination.
 * @param paths - Exact test source paths.
 * @param timeoutMillis - Process timeout.
 * @returns A supervised process specification.
 */
export const jestCommand = (
  cwd: string,
  outputFile: string,
  paths: ReadonlyArray<string>,
  timeoutMillis: number,
): ProcessSpec => ({
  command: "bun",
  args: ["x", "jest", "--runInBand", "--json", "--outputFile", outputFile, ...paths],
  cwd,
  timeoutMillis,
})

/**
 * Builds an `xcodebuild test` process specification.
 *
 * @param cwd - Owning native project directory.
 * @param workspace - Xcode workspace path.
 * @param scheme - Reviewed test scheme.
 * @param destination - Simulator or device destination.
 * @param resultBundle - Result bundle output path.
 * @param timeoutMillis - Process timeout.
 * @returns A supervised process specification.
 */
export const xctestCommand = (
  cwd: string,
  workspace: string,
  scheme: string,
  destination: string,
  resultBundle: string,
  timeoutMillis: number,
): ProcessSpec => ({
  command: "xcodebuild",
  args: [
    "test",
    "-workspace",
    workspace,
    "-scheme",
    scheme,
    "-destination",
    destination,
    "-resultBundlePath",
    resultBundle,
  ],
  cwd,
  timeoutMillis,
})

/**
 * Builds a Gradle unit or instrumentation test process specification.
 *
 * @param cwd - Owning Android project directory.
 * @param executable - Gradle wrapper or executable path.
 * @param instrumentation - Whether to select the connected-device task.
 * @param timeoutMillis - Process timeout.
 * @returns A supervised process specification.
 */
export const gradleCommand = (
  cwd: string,
  executable: string,
  instrumentation: boolean,
  timeoutMillis: number,
): ProcessSpec => ({
  command: executable,
  args: [instrumentation ? "connectedAndroidTest" : "testDebugUnitTest", "--no-daemon"],
  cwd,
  timeoutMillis,
})

/**
 * Builds a Maestro command that emits JUnit evidence.
 *
 * @param cwd - Flow working directory.
 * @param flow - Reviewed Maestro flow path.
 * @param outputFile - JUnit report destination.
 * @param timeoutMillis - Process timeout.
 * @returns A supervised process specification with Maestro shutdown grace.
 */
export const maestroCommand = (
  cwd: string,
  flow: string,
  outputFile: string,
  timeoutMillis: number,
): ProcessSpec => ({
  command: "maestro",
  args: ["test", flow, "--format", "junit", "--output", outputFile],
  cwd,
  timeoutMillis,
  terminationGraceMillis: 60_000,
})

const JestAssertion = Schema.Struct({
  fullName: Schema.String,
  ancestorTitles: Schema.optional(Schema.Array(Schema.String)),
  title: Schema.optional(Schema.String),
  status: Schema.String,
  duration: Schema.optional(Schema.NullOr(Schema.Number)),
  failureMessages: Schema.optional(Schema.Array(Schema.String)),
})
const JestOutput = Schema.Struct({
  testResults: Schema.Array(Schema.Struct({ assertionResults: Schema.Array(JestAssertion) })),
})
const JunitCase = Schema.Struct({
  $: Schema.Struct({
    name: Schema.String,
    classname: Schema.optional(Schema.String),
    time: Schema.optional(Schema.String),
    status: Schema.optional(Schema.String),
  }),
  failure: Schema.optional(Schema.Array(Schema.Unknown)),
  error: Schema.optional(Schema.Array(Schema.Unknown)),
  skipped: Schema.optional(Schema.Array(Schema.Unknown)),
})
interface JunitSuiteValue {
  readonly $?: { readonly name?: string | undefined } | undefined
  readonly testcase?: ReadonlyArray<Schema.Schema.Type<typeof JunitCase>> | undefined
  readonly testsuite?: ReadonlyArray<JunitSuiteValue> | undefined
}
const JunitSuite: Schema.Schema<JunitSuiteValue> & { readonly DecodingServices: never } =
  Schema.Struct({
    $: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String) })),
    testcase: Schema.optional(Schema.Array(JunitCase)),
    testsuite: Schema.optional(Schema.Array(Schema.suspend(() => JunitSuite))),
  })
const JunitSuites = Schema.Union([JunitSuite, Schema.Array(JunitSuite)])
const JunitOutput = Schema.Struct({
  testsuite: Schema.optional(JunitSuites),
  testsuites: Schema.optional(
    Schema.Union([
      Schema.Struct({ testsuite: Schema.optional(JunitSuites) }),
      Schema.Array(Schema.Struct({ testsuite: Schema.optional(JunitSuites) })),
    ]),
  ),
})
interface XcTestNodeValue {
  readonly name: string
  readonly nodeType?: string | undefined
  readonly result?: string | undefined
  readonly duration?: number | undefined
  readonly children?: ReadonlyArray<XcTestNodeValue> | undefined
}
const XcTestNode: Schema.Schema<XcTestNodeValue> & { readonly DecodingServices: never } =
  Schema.Struct({
    name: Schema.String,
    nodeType: Schema.optional(Schema.String),
    result: Schema.optional(Schema.String),
    duration: Schema.optional(Schema.Number),
    children: Schema.optional(Schema.Array(Schema.suspend(() => XcTestNode))),
  })

const decodeJson = <A>(
  runner: RunnerOutputError["runner"],
  schema: Schema.Schema<A> & { readonly DecodingServices: never },
  input: string,
) =>
  Effect.try({
    try: () => JSON.parse(input) as unknown,
    catch: (cause) => new RunnerOutputError({ runner, cause }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError((cause) =>
      cause instanceof RunnerOutputError ? cause : new RunnerOutputError({ runner, cause }),
    ),
  )

const caseId = (sourceId: TestSourceId, name: string, occurrence: number) =>
  TestCaseId.make(`${sourceId}#${name}@${occurrence}`)

const outcome = (
  status: string,
  durationMillis: number,
  failure: string | undefined,
): CaseResult["outcome"] =>
  Match.value(status).pipe(
    Match.whenOr("passed", "success", "Success", () => ({
      _tag: "passed" as const,
      durationMillis,
    })),
    Match.whenOr("skipped", "pending", "disabled", "Skipped", () => ({
      _tag: "skipped" as const,
      reason: status,
    })),
    Match.orElse(() => ({
      _tag: "failed" as const,
      durationMillis,
      message: failure ?? status,
      stack: null,
    })),
  )

/**
 * Converts normalized runner rows into the harness case-result model.
 *
 * @remarks
 * Case IDs are derived from source ID, normalized name, and occurrence index,
 * making duplicate titles representable without inventing unstable identifiers.
 *
 * @param runId - Run receiving the normalized results.
 * @param sourceId - Source that produced the runner report.
 * @param rows - Adapter-specific normalized rows.
 * @returns Case results suitable for external protocol validation.
 */
const materialize = (
  runId: RunId,
  sourceId: TestSourceId,
  rows: ReadonlyArray<{
    readonly name: string
    readonly status: string
    readonly durationMillis: number
    readonly failure: string | undefined
  }>,
) => {
  const occurrences = new Map<string, number>()
  return rows.map((row): CaseResult => {
    const occurrence = (occurrences.get(row.name) ?? 0) + 1
    occurrences.set(row.name, occurrence)
    return {
      schemaVersion: 1,
      runId,
      caseId: caseId(sourceId, row.name, occurrence),
      attempt: 1,
      outcome: outcome(row.status, row.durationMillis, row.failure),
      artifacts: [],
    }
  })
}

/**
 * Parses Jest JSON into normalized compatibility case results.
 *
 * @param runId - Run receiving the results.
 * @param sourceId - Source represented by the report.
 * @param input - Raw Jest JSON report.
 * @returns Normalized case results with stable occurrence identifiers.
 * @throws {@link RunnerOutputError} when JSON or report shape is invalid.
 */
export const parseJest = Effect.fn("ExternalRunnerAdapters.parseJest")(function* (
  runId: RunId,
  sourceId: TestSourceId,
  input: string,
) {
  const report = yield* decodeJson("jest", JestOutput, input)
  return materialize(
    runId,
    sourceId,
    report.testResults.flatMap(({ assertionResults }) =>
      assertionResults.map((entry) => ({
        name: jestCaseName(entry),
        status: entry.status,
        durationMillis: entry.duration ?? 0,
        failure: entry.failureMessages?.join("\n"),
      })),
    ),
  )
})

/**
 * Joins suite ancestry and a case title without duplicating existing hierarchy text.
 *
 * @param ancestors - Outer suite names.
 * @param title - Runner-provided case title.
 * @returns A stable ` > `-separated case name.
 */
export const hierarchicalCaseName = (ancestors: ReadonlyArray<string>, title: string): string => {
  const parts = ancestors.filter((part) => part.length > 0)
  if (parts.length === 0 || title.includes(" > ")) return title
  if (parts.at(-1) === title) return parts.join(" > ")
  return [...parts, title].join(" > ")
}

/**
 * Selects the most structured stable name available for a Jest assertion.
 *
 * @param entry - Jest assertion naming fields.
 * @returns A hierarchical case name.
 */
export const jestCaseName = (entry: {
  readonly fullName: string
  readonly ancestorTitles?: ReadonlyArray<string> | undefined
  readonly title?: string | undefined
}): string =>
  entry.ancestorTitles !== undefined && entry.title !== undefined
    ? hierarchicalCaseName(entry.ancestorTitles, entry.title)
    : entry.fullName

const isReadonlyArray = <A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> =>
  Array.isArray(value)

const asArray = <A>(value: A | ReadonlyArray<A> | undefined): ReadonlyArray<A> => {
  if (value === undefined) return []
  if (isReadonlyArray(value)) return value
  return [value]
}

const junitSuites = (report: Schema.Schema.Type<typeof JunitOutput>) => [
  ...asArray(report.testsuite),
  ...asArray(report.testsuites).flatMap(({ testsuite }) => asArray(testsuite)),
]

const junitStatus = (entry: Schema.Schema.Type<typeof JunitCase>) => {
  if (entry.skipped !== undefined) return "skipped"
  if (entry.failure !== undefined || entry.error !== undefined) return "failed"
  return entry.$.status ?? "passed"
}

const junitCaseName = (
  ancestors: ReadonlyArray<string>,
  entry: Schema.Schema.Type<typeof JunitCase>,
): string => {
  if (ancestors.length > 0) return hierarchicalCaseName(ancestors, entry.$.name)
  const classname = entry.$.classname
  return classname === undefined || classname === "test"
    ? entry.$.name
    : hierarchicalCaseName([classname], entry.$.name)
}

const junitRows = (report: Schema.Schema.Type<typeof JunitOutput>) => {
  const rows: Array<{
    readonly entry: Schema.Schema.Type<typeof JunitCase>
    readonly name: string
  }> = []
  const visit = (suite: JunitSuiteValue, ancestors: ReadonlyArray<string>) => {
    const suiteName = suite.$?.name
    const next = suiteName === undefined ? ancestors : [...ancestors, suiteName]
    for (const entry of suite.testcase ?? []) {
      rows.push({ entry, name: junitCaseName(next, entry) })
    }
    for (const child of suite.testsuite ?? []) visit(child, next)
  }
  for (const suite of junitSuites(report)) visit(suite, [])
  return rows
}

/**
 * Parses nested JUnit XML into normalized compatibility case results.
 *
 * @param runner - Runner family that produced the report.
 * @param runId - Run receiving the results.
 * @param sourceId - Source represented by the report.
 * @param input - Raw JUnit XML.
 * @returns Normalized case results preserving suite ancestry.
 * @throws {@link RunnerOutputError} when XML or report shape is invalid.
 */
export const parseJunit = Effect.fn("ExternalRunnerAdapters.parseJunit")(function* (
  runner:
    | "node-test"
    | "bun-test"
    | "gradle-unit"
    | "gradle-instrumentation"
    | "maestro"
    | "playwright"
    | "detox"
    | "workflow",
  runId: RunId,
  sourceId: TestSourceId,
  input: string,
) {
  const parsed = yield* Effect.tryPromise({
    try: () => parseStringPromise(input, { explicitArray: true }) as Promise<unknown>,
    catch: (cause) => new RunnerOutputError({ runner, cause }),
  })
  const report = yield* Schema.decodeUnknownEffect(JunitOutput)(parsed).pipe(
    Effect.mapError((cause) => new RunnerOutputError({ runner, cause })),
  )
  return materialize(
    runId,
    sourceId,
    junitRows(report).map(({ entry, name }) => ({
      name,
      status: junitStatus(entry),
      durationMillis: Math.round(Number(entry.$.time ?? 0) * 1_000),
      failure: JSON.stringify(entry.failure ?? entry.error),
    })),
  )
})

/**
 * Parses `xcresulttool` JSON into normalized compatibility case results.
 *
 * @param runId - Run receiving the results.
 * @param sourceId - Source represented by the report.
 * @param input - Raw XCTest result-tree JSON.
 * @returns Normalized leaf results from the recursive XCTest tree.
 * @throws {@link RunnerOutputError} when JSON or report shape is invalid.
 */
export const parseXcTest = Effect.fn("ExternalRunnerAdapters.parseXcTest")(function* (
  runId: RunId,
  sourceId: TestSourceId,
  input: string,
) {
  const root = yield* decodeJson("xctest", XcTestNode, input)
  const rows: Array<{
    name: string
    status: string
    durationMillis: number
    failure: string | undefined
  }> = []
  const visit = (node: XcTestNodeValue) => {
    if (node.result !== undefined) {
      rows.push({
        name: node.name,
        status: node.result,
        durationMillis: Math.round((node.duration ?? 0) * 1_000),
        failure: undefined,
      })
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  return materialize(runId, sourceId, rows)
})
