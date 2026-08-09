import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import {
  CaseResult,
  RunId,
  TestSourceId,
  isSafePathSegment,
  type CaseResult as CaseResultType,
} from "../Domain.ts"
import { ArtifactLifecycle } from "../artifacts/ArtifactLifecycle.ts"
import { EvidenceStore } from "../evidence/EvidenceStore.ts"
import { HarnessConfig, layer as harnessConfigLayer } from "../HarnessConfig.ts"
import { applyBuildProfile } from "../build/BuildProfile.ts"
import * as ExternalRunnerAdapters from "../runners/ExternalRunnerAdapters.ts"
import { ProcessSupervisor, type ProcessSpec } from "./ProcessSupervisor.ts"

/** Reviewed command and report contract for one external runner execution. */
export const ExternalRunRequest = Schema.Struct({
  reviewed: Schema.Literal(true),
  id: RunId,
  runner: Schema.Literals([
    "jest",
    "node-test",
    "bun-test",
    "xctest",
    "gradle-unit",
    "gradle-instrumentation",
    "maestro",
    "playwright",
    "detox",
    "workflow",
  ]),
  runId: RunId,
  sourceId: TestSourceId,
  commands: Schema.Array(
    Schema.Struct({
      command: Schema.NonEmptyString,
      args: Schema.Array(Schema.String),
      cwd: Schema.optional(Schema.String),
      env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      timeoutMillis: Schema.Number,
      terminationGraceMillis: Schema.optional(Schema.Number),
    }),
  ),
  reportPath: Schema.NonEmptyString,
})
/** Decoded external runner request accepted by {@link ExternalRunRequest}. */
export type ExternalRunRequest = Schema.Schema.Type<typeof ExternalRunRequest>

/** Failure raised while running, parsing, or recording external test output. */
export class ExternalRunnerError extends Data.TaggedError("ExternalRunnerError")<{
  readonly request: ExternalRunRequest
  readonly phase: "process" | "report" | "evidence"
  readonly cause: unknown
}> {}

/** External runner operation that returns validated case results. */
export interface Service {
  readonly run: (
    request: ExternalRunRequest,
  ) => Effect.Effect<ReadonlyArray<CaseResultType>, ExternalRunnerError>
}

/** Effect context tag for reviewed external runner execution. */
export class ExternalRunnerSupervisor extends Context.Service<ExternalRunnerSupervisor, Service>()(
  "@better-native/compatibility-harness/ExternalRunnerSupervisor",
) {}

const Results = Schema.Array(CaseResult)
const maximumReportBytes = 16 * 1024 * 1024
const executableNames: Readonly<Record<ExternalRunRequest["runner"], ReadonlySet<string>>> = {
  jest: new Set(["bun", "jest", "mkdir", "node", "npx", "pnpm"]),
  "node-test": new Set(["mkdir", "node", "pnpm"]),
  "bun-test": new Set(["bun", "mkdir"]),
  xctest: new Set(["mkdir", "xcodebuild", "xcrun"]),
  "gradle-unit": new Set(["gradle", "gradlew", "java", "mkdir"]),
  "gradle-instrumentation": new Set(["gradle", "gradlew", "java", "mkdir"]),
  maestro: new Set(["maestro", "mkdir"]),
  playwright: new Set(["bun", "mkdir", "node", "npx", "pnpm"]),
  detox: new Set(["bun", "detox", "jest", "mkdir", "node", "npx", "pnpm"]),
  workflow: new Set(["bun", "mkdir", "node", "pnpm"]),
}

const reportExtensionFor = (runner: ExternalRunRequest["runner"]): ".json" | ".xml" =>
  Match.value(runner).pipe(
    Match.whenOr("jest", "xctest", () => ".json" as const),
    Match.orElse(() => ".xml" as const),
  )

const parseReport = (
  runner: ExternalRunRequest["runner"],
  runId: RunId,
  sourceId: TestSourceId,
  report: string,
) =>
  Match.value(runner).pipe(
    Match.when("jest", () => ExternalRunnerAdapters.parseJest(runId, sourceId, report)),
    Match.when("xctest", () => ExternalRunnerAdapters.parseXcTest(runId, sourceId, report)),
    Match.orElse((junitRunner) =>
      ExternalRunnerAdapters.parseJunit(junitRunner, runId, sourceId, report),
    ),
  )

/**
 * Builds an external runner supervisor confined to the repository root.
 *
 * @remarks
 * Commands, working directories, and reports are checked against reviewed roots;
 * report size and executable names are bounded before output becomes evidence.
 *
 * @param root - Better Native repository root.
 * @returns A layer providing {@link ExternalRunnerSupervisor}.
 */
export const layer = (
  root: string,
): Layer.Layer<
  ExternalRunnerSupervisor,
  never,
  ProcessSupervisor | EvidenceStore | FileSystem.FileSystem | Path.Path | ArtifactLifecycle
> =>
  Layer.effect(
    ExternalRunnerSupervisor,
    Effect.gen(function* () {
      const processes = yield* ProcessSupervisor
      const evidence = yield* EvidenceStore
      const artifactLifecycle = yield* ArtifactLifecycle
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const config = yield* HarnessConfig
      const javaHome17 = config.javaHome17
      const requestedRoot = path.resolve(root)
      const canonicalRoot = yield* fs.realPath(root).pipe(Effect.orDie)
      const resolveExisting = (input: string, purpose: string) =>
        Effect.gen(function* () {
          const target = path.isAbsolute(input)
            ? path.resolve(input)
            : path.resolve(requestedRoot, input)
          const requestedRelative = path.relative(requestedRoot, target)
          if (requestedRelative === ".." || requestedRelative.startsWith(`..${path.sep}`)) {
            return yield* Effect.fail(`${purpose} escapes the reviewed repository: ${input}`)
          }
          const canonical = yield* fs.realPath(target)
          const expected = path.resolve(canonicalRoot, requestedRelative)
          const canonicalRelative = path.relative(canonicalRoot, canonical)
          if (
            canonical !== expected ||
            canonicalRelative === ".." ||
            canonicalRelative.startsWith(`..${path.sep}`)
          ) {
            return yield* Effect.fail(
              `${purpose} uses a symbolic-link path: ${input} -> ${canonical}`,
            )
          }
          return canonical
        })
      const resolveReport = (input: string, requestId: string, reportExtension: ".json" | ".xml") =>
        Effect.gen(function* () {
          if (!isSafePathSegment(requestId)) {
            return yield* Effect.fail(`external run ID is not a safe path segment: ${requestId}`)
          }
          const target = path.isAbsolute(input)
            ? path.resolve(input)
            : path.resolve(requestedRoot, input)
          const expectedDirectory = path.join(
            requestedRoot,
            ".artifacts",
            "runs",
            requestId,
            "external",
          )
          const expectedExtension = reportExtension
          if (
            path.dirname(target) !== expectedDirectory ||
            path.extname(target) !== expectedExtension
          ) {
            return yield* Effect.fail(
              `report path must be ${expectedDirectory}${path.sep}*${expectedExtension}`,
            )
          }
          let current = requestedRoot
          for (const segment of [".artifacts", "runs", requestId, "external"]) {
            current = path.join(current, segment)
            if (!(yield* fs.exists(current))) yield* fs.makeDirectory(current)
            yield* resolveExisting(current, "report directory")
          }
          const canonicalParent = yield* resolveExisting(expectedDirectory, "report directory")
          const expected = path.join(canonicalParent, path.basename(target))
          if (yield* fs.exists(expected)) {
            const canonical = yield* fs.realPath(expected)
            if (canonical !== expected) {
              return yield* Effect.fail(
                `report path uses a symbolic link: ${input} -> ${canonical}`,
              )
            }
          }
          return expected
        })
      const readReport = (reportPath: string) =>
        Effect.scoped(
          Effect.gen(function* () {
            const file = yield* fs.open(reportPath, { flag: "r" })
            const openedInfo = yield* file.stat
            if (openedInfo.type !== "File") {
              return yield* Effect.fail("runner report must be a regular file")
            }
            const canonicalReport = yield* fs.realPath(reportPath)
            if (canonicalReport !== reportPath) {
              return yield* Effect.fail(
                `report path uses a symbolic link: ${reportPath} -> ${canonicalReport}`,
              )
            }
            const pathInfo = yield* fs.stat(reportPath)
            if (
              pathInfo.type !== "File" ||
              pathInfo.dev !== openedInfo.dev ||
              Option.getOrNull(pathInfo.ino) !== Option.getOrNull(openedInfo.ino)
            ) {
              return yield* Effect.fail("runner report changed while it was being opened")
            }
            if (Number(openedInfo.size) > maximumReportBytes) {
              return yield* Effect.fail(
                `runner report must be a regular file no larger than ${maximumReportBytes} bytes`,
              )
            }
            const chunks: Array<Uint8Array> = []
            let totalBytes = 0
            for (;;) {
              const capacity = Math.min(64 * 1024, maximumReportBytes + 1 - totalBytes)
              const chunk = yield* file.readAlloc(FileSystem.Size(capacity))
              if (Option.isNone(chunk)) break
              totalBytes += chunk.value.byteLength
              if (totalBytes > maximumReportBytes) {
                return yield* Effect.fail(
                  `runner report must be a regular file no larger than ${maximumReportBytes} bytes`,
                )
              }
              chunks.push(chunk.value)
            }
            const bytes = new Uint8Array(totalBytes)
            let offset = 0
            for (const chunk of chunks) {
              bytes.set(chunk, offset)
              offset += chunk.byteLength
            }
            return new TextDecoder().decode(bytes)
          }),
        )
      const run: Service["run"] = (request) =>
        Effect.gen(function* () {
          const reportExtension = reportExtensionFor(request.runner)
          const initialReport = yield* resolveReport(
            request.reportPath,
            request.id,
            reportExtension,
          ).pipe(
            Effect.mapError(
              (cause) => new ExternalRunnerError({ request, phase: "report", cause }),
            ),
          )
          if (yield* fs.exists(initialReport)) {
            const reportPath = initialReport
            yield* fs.remove(reportPath)
          }
          for (const [index, command] of request.commands.entries()) {
            const executable = path.basename(command.command)
            if (
              executable !== command.command ||
              !executableNames[request.runner].has(executable)
            ) {
              return yield* new ExternalRunnerError({
                request,
                phase: "process",
                cause: `${command.command} is not an allowed ${request.runner} runner command`,
              })
            }
            const cwd = yield* resolveExisting(
              command.cwd ?? root,
              "runner working directory",
            ).pipe(
              Effect.mapError(
                (cause) => new ExternalRunnerError({ request, phase: "process", cause }),
              ),
            )
            const requiresJava17 =
              request.runner === "maestro" ||
              request.runner === "gradle-unit" ||
              request.runner === "gradle-instrumentation"
            if (requiresJava17 && javaHome17 === null) {
              return yield* new ExternalRunnerError({
                request,
                phase: "process",
                cause: "runner requires a verified JDK 17",
              })
            }
            const runnerEnvironment = requiresJava17
              ? {
                  ...command.env,
                  JAVA_HOME: javaHome17 as string,
                  PATH: `${javaHome17 as string}${path.sep}bin${process.platform === "win32" ? ";" : ":"}${config.executablePath}`,
                }
              : command.env
            const spec: ProcessSpec = {
              command: command.command,
              args: command.args,
              timeoutMillis: command.timeoutMillis,
              cwd,
              ...(runnerEnvironment === undefined ? {} : { env: runnerEnvironment }),
              ...(command.terminationGraceMillis === undefined
                ? {}
                : { terminationGraceMillis: command.terminationGraceMillis }),
            }
            const nativeCompiler =
              executable === "xcodebuild" || executable === "gradle" || executable === "gradlew"
            const profiledSpec = nativeCompiler
              ? applyBuildProfile(
                  config.buildProfile,
                  executable === "xcodebuild" ? "xcode" : "gradle",
                  spec,
                )
              : spec
            const execution = nativeCompiler
              ? Effect.scoped(
                  artifactLifecycle
                    .acquireNativeBuild(`external:${request.id}:${executable}`)
                    .pipe(Effect.andThen(processes.run(profiledSpec))),
                )
              : processes.run(profiledSpec)
            const result = yield* execution.pipe(
              Effect.mapError(
                (cause) => new ExternalRunnerError({ request, phase: "process", cause }),
              ),
            )
            // Test runners commonly exit non-zero when individual cases fail. A
            // report is still authoritative; only a missing report is an
            // infrastructure failure.
            const isRunnerCommand = index === request.commands.length - 1
            if (result.exitCode !== 0) {
              const hasReport = isRunnerCommand
                ? yield* resolveReport(request.reportPath, request.id, reportExtension).pipe(
                    Effect.flatMap(fs.exists),
                    Effect.mapError(
                      (cause) => new ExternalRunnerError({ request, phase: "report", cause }),
                    ),
                  )
                : false
              if (!hasReport) {
                return yield* new ExternalRunnerError({
                  request,
                  phase: "process",
                  cause: `runner exited ${result.exitCode} without producing ${request.reportPath}`,
                })
              }
            }
          }
          const reportPath = yield* resolveReport(
            request.reportPath,
            request.id,
            reportExtension,
          ).pipe(
            Effect.mapError(
              (cause) => new ExternalRunnerError({ request, phase: "report", cause }),
            ),
          )
          const report = yield* readReport(reportPath).pipe(
            Effect.mapError(
              (cause) => new ExternalRunnerError({ request, phase: "report", cause }),
            ),
          )
          const parse = parseReport(request.runner, request.runId, request.sourceId, report)
          const results = yield* parse.pipe(
            Effect.mapError(
              (cause) => new ExternalRunnerError({ request, phase: "report", cause }),
            ),
          )
          yield* evidence
            .writeJson("runs", request.id, "external-results.json", Results, results)
            .pipe(
              Effect.mapError(
                (cause) => new ExternalRunnerError({ request, phase: "evidence", cause }),
              ),
            )
          return results
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof ExternalRunnerError
              ? cause
              : new ExternalRunnerError({ request, phase: "report", cause }),
          ),
        )
      return ExternalRunnerSupervisor.of({ run })
    }),
  ).pipe(Layer.provide(harnessConfigLayer(root).pipe(Layer.orDie)))
