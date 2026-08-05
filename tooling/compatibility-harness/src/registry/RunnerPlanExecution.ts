import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { ExpoRepository } from "../ExpoRepository.ts"
import { HarnessError } from "../HarnessError.ts"
import * as ExternalRunProtocol from "../protocol/ExternalRunProtocol.ts"
import {
  ExternalRunnerSupervisor,
  ExternalRunRequest,
} from "../supervision/ExternalRunnerSupervisor.ts"
import * as Suites from "../suites/Suites.ts"
import * as AppRegistry from "./AppRegistry.ts"

const Status = Schema.Struct({
  sourceId: Schema.String,
  runner: Schema.String,
  status: Schema.Literals(["passed", "failed", "blocked", "not-run"]),
  reason: Schema.NullOr(Schema.String),
})
const Report = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  shardIndex: Schema.Int,
  shardCount: Schema.Int,
  runner: Schema.String,
  entries: Schema.Array(Status),
})

/** CLI execution options for one runner-plan shard. */
export interface Options {
  readonly runner: string
  readonly shardIndex: number
  readonly shardCount: number
  readonly timeoutMillis: number
  readonly reportPath: string
}

/**
 * Expands the narrow placeholder set allowed in a reviewed runner command.
 *
 * @remarks
 * Expansion is deliberately not shell interpolation. Only known plan fields
 * are substituted, keeping executable plans deterministic and bounded.
 *
 * @param value - Reviewed command or argument template.
 * @param repositoryRoot - Canonical Better Native repository root.
 * @param expoRoot - Canonical pinned Expo source root.
 * @param runId - Safe run identifier used for report paths.
 * @returns The expanded command text.
 */
export const expandTemplate = (
  value: string,
  repositoryRoot: string,
  expoRoot: string,
  runId: string,
): string =>
  value
    .replaceAll("{repositoryRoot}", repositoryRoot)
    .replaceAll("{expoRoot}", expoRoot)
    .replaceAll("{runId}", runId)

/**
 * Executes one deterministic shard of reviewed external runner plans.
 *
 * @remarks
 * Executable entries are selected by stable ledger index. Blocked entries remain
 * in the output report so unsupported sources cannot disappear from coverage.
 *
 * @param options - Runner filter, shard bounds, timeout, and output path.
 * @returns An Effect that completes after the shard report is written.
 * @throws {@link HarnessError} for invalid shards, stale ledgers, or report failures.
 */
export const run = Effect.fn("RunnerPlanExecution.run")(function* (options: Options) {
  if (
    options.shardCount < 1 ||
    options.shardIndex < 0 ||
    options.shardIndex >= options.shardCount
  ) {
    return yield* new HarnessError({
      operation: "validate runner-plan shard",
      cause: `shard ${options.shardIndex} is outside shard count ${options.shardCount}`,
    })
  }
  const repository = yield* ExpoRepository
  const supervisor = yield* ExternalRunnerSupervisor
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const [ledger, corpus] = yield* Effect.all([
    AppRegistry.loadRunnerPlanLedger(),
    Suites.discover(),
  ])
  const candidates = ledger.entries.filter(
    (entry) =>
      entry.status === "executable" &&
      (options.runner === "all" || entry.runner === options.runner),
  )
  const selected = new Set(
    candidates
      .filter((_, index) => index % options.shardCount === options.shardIndex)
      .map(({ sourceId }) => sourceId),
  )
  const statuses = [] as Array<Schema.Schema.Type<typeof Status>>
  let selectedIndex = 0
  for (const entry of ledger.entries) {
    if (entry.status === "blocked") {
      statuses.push({
        sourceId: entry.sourceId,
        runner: entry.runner,
        status: "blocked",
        reason: entry.reason,
      })
      continue
    }
    if (!selected.has(entry.sourceId)) {
      statuses.push({
        sourceId: entry.sourceId,
        runner: entry.runner,
        status: "not-run",
        reason:
          options.runner !== "all" && entry.runner !== options.runner
            ? "runner family not selected"
            : "different shard",
      })
      continue
    }
    const command = entry.command
    if (command === null || command.reportPath === null) {
      statuses.push({
        sourceId: entry.sourceId,
        runner: entry.runner,
        status: "failed",
        reason: "executable plan has no report command",
      })
      continue
    }
    const runId = `ledger-${options.runner}-${options.shardIndex}-${selectedIndex++}`
    const reportPath = expandTemplate(
      command.reportPath,
      repository.root,
      repository.expoRoot,
      runId,
    )
    const request = yield* Schema.decodeUnknownEffect(ExternalRunRequest)({
      reviewed: true,
      id: runId,
      runner: entry.runner,
      runId,
      sourceId: entry.sourceId,
      commands: [
        {
          command: command.command,
          args: command.args.map((value) =>
            expandTemplate(value, repository.root, repository.expoRoot, runId),
          ),
          cwd: expandTemplate(command.cwd, repository.root, repository.expoRoot, runId),
          env: Object.fromEntries(
            Object.entries(command.env).map(([key, value]) => [
              key,
              expandTemplate(value, repository.root, repository.expoRoot, runId),
            ]),
          ),
          timeoutMillis: options.timeoutMillis,
          terminationGraceMillis: 30_000,
        },
      ],
      reportPath,
    }).pipe(
      Effect.mapError(
        (cause) => new HarnessError({ operation: "decode generated runner plan", cause }),
      ),
    )
    const staticCaseIds = corpus.cases
      .filter(({ sourceId }) => sourceId === entry.sourceId)
      .map(({ id }) => id)
    const status = yield* supervisor.run(request).pipe(
      Effect.flatMap((results) =>
        ExternalRunProtocol.validate({ sourceId: request.sourceId, staticCaseIds }, results),
      ),
      Effect.as({
        sourceId: entry.sourceId,
        runner: entry.runner,
        status: "passed" as const,
        reason: null,
      }),
      Effect.catch((cause) =>
        Effect.succeed({
          sourceId: entry.sourceId,
          runner: entry.runner,
          status: "failed" as const,
          reason: String(cause),
        }),
      ),
    )
    statuses.push(status)
  }
  const report = yield* Schema.decodeUnknownEffect(Report)({
    schemaVersion: 1,
    expoRevision: ledger.expoRevision,
    shardIndex: options.shardIndex,
    shardCount: options.shardCount,
    runner: options.runner,
    entries: statuses,
  })
  const output = path.resolve(options.reportPath)
  yield* fs.makeDirectory(path.dirname(output), { recursive: true })
  yield* fs.writeFileString(output, `${JSON.stringify(report, null, 2)}\n`)
  const failures = statuses.filter(({ status }) => status === "failed")
  yield* Console.log(
    `Runner-plan shard wrote ${output}; ${selected.size} selected, ${failures.length} failed`,
  )
  if (failures.length > 0) {
    return yield* new HarnessError({
      operation: "execute generated runner plans",
      cause: failures.map(({ sourceId, reason }) => `${sourceId}: ${reason}`),
    })
  }
  return report
})
