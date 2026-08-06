import type { CorpusSnapshot, TestSource } from "../Domain.ts"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"

/** Versioned ledger assigning every non-app source an executable plan or blocker. */
export const RunnerPlanLedgerSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  entries: Schema.Array(
    Schema.Struct({
      sourceId: Schema.String,
      path: Schema.String,
      runner: Schema.String,
      executability: Schema.String,
      status: Schema.Literals(["executable", "blocked"]),
      command: Schema.NullOr(
        Schema.Struct({
          command: Schema.String,
          args: Schema.Array(Schema.String),
          cwd: Schema.String,
          env: Schema.Record(Schema.String, Schema.String),
          reportFormat: Schema.NullOr(Schema.Literals(["jest-json", "junit"])),
          reportPath: Schema.NullOr(Schema.String),
        }),
      ),
      reason: Schema.NullOr(Schema.String),
    }),
  ),
})

/** Reviewed command template for one external test source. */
export interface CommandPlan {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly reportFormat: "jest-json" | "junit" | null
  readonly reportPath: string | null
}

/** Executable or explicitly blocked disposition for one discovered source. */
export interface RunnerPlanEntry {
  readonly sourceId: string
  readonly path: string
  readonly runner: TestSource["runner"]
  readonly executability: TestSource["executability"]
  readonly status: "executable" | "blocked"
  readonly command: CommandPlan | null
  readonly reason: string | null
}

/** Complete external runner disposition for the pinned test corpus. */
export interface RunnerPlanLedger {
  readonly schemaVersion: 1
  readonly expoRevision: string
  readonly entries: ReadonlyArray<RunnerPlanEntry>
}

const workspace = (file: string): string => {
  const parts = file.split("/")
  if (parts[0] === "packages")
    return parts[1]?.startsWith("@") ? parts.slice(0, 3).join("/") : parts.slice(0, 2).join("/")
  if (parts[0] === "apps") return parts.slice(0, 2).join("/")
  return parts[0] ?? "."
}

const relativeTo = (file: string, directory: string): string =>
  file.startsWith(`${directory}/`) ? file.slice(directory.length + 1) : file

const reportName = (sourceId: string): string => {
  let hash = 2166136261
  for (const character of sourceId) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const prefix = sourceId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 72)
  return `${prefix}-${(hash >>> 0).toString(16)}`
}

const report = (source: TestSource, extension: string) =>
  `{repositoryRoot}/.artifacts/runs/{runId}/external/${reportName(source.id)}.${extension}`

const jestBlocker = (source: TestSource): string | null => {
  const owner = workspace(source.path)
  return Match.value(owner).pipe(
    Match.when(
      "docs",
      () =>
        "Expo docs tests require the workspace generate-static-resources setup and Node VM-module flags from its authoritative test script.",
    ),
    Match.when(
      "packages/html-elements",
      () =>
        "@expo/html-elements selects separate Babel and source Jest configurations through workspace test scripts; a generic source command is not authoritative.",
    ),
    Match.when(
      "packages/expo-type-information",
      () =>
        "expo-type-information tests require macOS and sourceKitten according to the pinned workspace test contract.",
    ),
    Match.whenOr(
      "apps/bare-expo",
      "packages/expo-audio",
      (blockedOwner) =>
        `${blockedOwner} has no authoritative Jest test script in the pinned Expo workspace.`,
    ),
    Match.orElse(() => null),
  )
}

/**
 * Derives a reviewed external command plan for one source when supported.
 *
 * @remarks
 * Returning `null` is intentional: unsupported sources remain in the ledger
 * with an explicit blocker rather than disappearing from the denominator.
 *
 * @param source - Discovered source and its declared runner.
 * @returns A bounded command plan, or `null` when no safe adapter exists.
 */
const concrete = (source: TestSource): CommandPlan | null => {
  // Discovery-required sources need a prepared application, device, or owning
  // runner configuration. A command that merely names their source file would
  // claim executability without satisfying those preconditions.
  if (source.executability === "runtime-discovery-required") return null
  if (source.runner === "jest" && jestBlocker(source) !== null) return null
  if (source.runner === "jest" && source.caseEvidence === "none") return null
  const cwd = `{expoRoot}/${workspace(source.path)}`
  const relative = relativeTo(source.path, workspace(source.path))
  return Match.value(source.runner).pipe(
    Match.when("jest", () => {
      const output = report(source, "json")
      return {
        command: "pnpm",
        args: [
          "test",
          "--",
          "--runInBand",
          "--runTestsByPath",
          "--json",
          "--outputFile",
          output,
          relative,
        ],
        cwd,
        env: {},
        reportFormat: "jest-json",
        reportPath: output,
      } satisfies CommandPlan
    }),
    Match.when("node-test", () => {
      const output = report(source, "xml")
      const compiled = relative.replace(/^src\//, "build/").replace(/\.ts$/, ".js")
      return {
        command: "node",
        args: [
          "--test",
          "--test-reporter=junit",
          `--test-reporter-destination=${output}`,
          compiled,
        ],
        cwd,
        env: {},
        reportFormat: "junit",
        reportPath: output,
      } satisfies CommandPlan
    }),
    Match.when("bun-test", () => {
      const output = report(source, "xml")
      return {
        command: "bun",
        args: ["test", relative, "--reporter=junit", `--reporter-outfile=${output}`],
        cwd,
        env: {},
        reportFormat: "junit",
        reportPath: output,
      } satisfies CommandPlan
    }),
    Match.when("playwright", () => {
      const output = report(source, "xml")
      return {
        command: "pnpm",
        args: ["exec", "playwright", "test", relative, "--reporter=junit"],
        cwd,
        env: { PLAYWRIGHT_JUNIT_OUTPUT_FILE: output },
        reportFormat: "junit",
        reportPath: output,
      } satisfies CommandPlan
    }),
    Match.when("maestro", () => {
      const output = report(source, "xml")
      return {
        command: "maestro",
        args: ["test", `{expoRoot}/${source.path}`, "--format", "junit", "--output", output],
        cwd: "{expoRoot}",
        env: {},
        reportFormat: "junit",
        reportPath: output,
      } satisfies CommandPlan
    }),
    Match.whenOr(
      "expo-jasmine",
      "xctest",
      "gradle-unit",
      "gradle-instrumentation",
      "detox",
      "workflow",
      () => null,
    ),
    Match.exhaustive,
  )
}

const blockedReason = (source: TestSource): string => {
  if (source.reason !== null) return source.reason
  const workspaceReason = source.runner === "jest" ? jestBlocker(source) : null
  if (workspaceReason !== null) return workspaceReason
  if (source.runner === "jest" && source.caseEvidence === "none") {
    return "The source contains no static or dynamic Jest case declaration evidence and is treated as a support input until authoritative Jest discovery selects it."
  }
  return Match.value(source.runner).pipe(
    Match.when(
      "expo-jasmine",
      () =>
        "The file is not an executable Expo Jasmine module and requires an upstream-specific adapter.",
    ),
    Match.when(
      "xctest",
      () =>
        "XCTest execution requires discovery of the owning Xcode workspace, scheme and destination from the generated native project.",
    ),
    Match.whenOr(
      "gradle-unit",
      "gradle-instrumentation",
      () =>
        "Gradle execution requires discovery of the owning project, variant and test task from the generated Android project.",
    ),
    Match.when(
      "workflow",
      () =>
        "The workflow is orchestration metadata; its commands are represented by concrete runner entries.",
    ),
    Match.when(
      "detox",
      () =>
        "Detox uses project-specific Jest configuration and has no reviewed JUnit reporter contract in the pinned fixture.",
    ),
    Match.whenOr(
      "jest",
      "node-test",
      "bun-test",
      "maestro",
      "playwright",
      (runner) => `The ${runner} adapter has no reviewed executable command for this source.`,
    ),
    Match.exhaustive,
  )
}

/**
 * Builds the external runner ledger for sources not hosted by the compatibility app.
 *
 * @remarks
 * Every source remains visible. Sources without a reviewed command receive a
 * concrete blocker reason rather than being omitted from the denominator.
 *
 * @param corpus - Complete discovered test corpus.
 * @param appRunnableSourceIds - Sources already executed by the generated app.
 * @returns A deterministic runner-plan ledger.
 */
export const make = (
  corpus: CorpusSnapshot,
  appRunnableSourceIds: ReadonlySet<string>,
): RunnerPlanLedger => ({
  schemaVersion: 1,
  expoRevision: corpus.expoRevision,
  entries: corpus.sources
    .filter(({ id }) => !appRunnableSourceIds.has(id))
    .map((source): RunnerPlanEntry => {
      const command = source.executability === "non-executable" ? null : concrete(source)
      return command === null
        ? {
            sourceId: source.id,
            path: source.path,
            runner: source.runner,
            executability: source.executability,
            status: "blocked",
            command: null,
            reason: blockedReason(source),
          }
        : {
            sourceId: source.id,
            path: source.path,
            runner: source.runner,
            executability: source.executability,
            status: "executable",
            command,
            reason: null,
          }
    })
    .toSorted((left, right) => left.sourceId.localeCompare(right.sourceId)),
})

/**
 * Validates runner-plan coverage against the current corpus.
 *
 * @param corpus - Complete discovered test corpus.
 * @param ledger - Generated runner-plan disposition.
 * @param appRunnableSourceIds - Sources owned by the compatibility app.
 * @returns Missing, conflicting, or incomplete disposition issues.
 */
export const issues = (
  corpus: CorpusSnapshot,
  ledger: RunnerPlanLedger,
  appRunnableSourceIds: ReadonlySet<string>,
): ReadonlyArray<string> => {
  const values: Array<string> = []
  const entries = new Map(ledger.entries.map((entry) => [entry.sourceId, entry]))
  for (const source of corpus.sources) {
    const entry = entries.get(source.id)
    if (appRunnableSourceIds.has(source.id)) {
      if (entry !== undefined)
        values.push(`${source.id}: app source must not have an external plan`)
      continue
    }
    if (entry === undefined) {
      values.push(`${source.id}: non-app source has no runner plan disposition`)
      continue
    }
    if (entry.runner !== source.runner || entry.executability !== source.executability) {
      values.push(`${source.id}: runner plan classification drifted from the corpus`)
    }
    if (entry.status === "executable" && entry.command === null) {
      values.push(`${source.id}: executable status has no command plan`)
    }
    if (entry.status === "blocked" && (entry.reason === null || entry.reason.length === 0)) {
      values.push(`${source.id}: blocked status has no reviewed reason`)
    }
  }
  return values
}
