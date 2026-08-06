import { serveReportUi } from "@vitest-evals/report-ui"
import * as Crypto from "effect/Crypto"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import * as Config from "../Config.ts"
import * as Domain from "../Domain.ts"

const JudgeScoreMetadata = Schema.Struct({
  score: Schema.Number,
  name: Schema.Literal("RequiredGateJudge"),
  metadata: Schema.Struct({
    rationale: Domain.NonEmptyString,
    output: Schema.Unknown,
  }),
})

const HarnessMetadata = Schema.Struct({
  eval: Schema.Struct({
    scores: Schema.NonEmptyArray(JudgeScoreMetadata),
    avgScore: Schema.Number,
    thresholdFailed: Schema.Boolean,
  }),
  harness: Schema.Struct({
    name: Schema.Literal("better-native-dx"),
    run: Schema.Struct({
      session: Schema.Struct({ events: Schema.Array(Schema.Unknown) }),
      output: Schema.Struct({
        schemaVersion: Schema.Literal(1),
        runId: Domain.NonEmptyString,
        taskId: Domain.NonEmptyString,
        infrastructureStatus: Schema.Literal("valid"),
        requiredGates: Schema.Array(Schema.Unknown),
        transcript: Schema.Array(Schema.Unknown),
        usage: Schema.Unknown,
        publicEvidence: Schema.Struct({
          status: Schema.Literal("process-authenticated"),
          digest: Domain.NonEmptyString,
        }),
      }),
      usage: Schema.Unknown,
      artifacts: Schema.Struct({
        "evidence-reference": Schema.Struct({
          status: Schema.Literal("process-authenticated"),
          digest: Domain.NonEmptyString,
        }),
      }),
      errors: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(0)),
      traces: Schema.Array(Schema.Unknown),
    }),
  }),
})

const JsonReport = Schema.fromJsonString(
  Schema.Struct({
    success: Schema.Boolean,
    numTotalTests: Schema.Number,
    numFailedTests: Schema.Number,
    testResults: Schema.Array(
      Schema.Struct({
        assertionResults: Schema.Array(
          Schema.Struct({
            status: Schema.String,
            meta: Schema.Unknown,
          }),
        ),
      }),
    ),
  }),
)

/** Failure raised when the deterministic report artifact or UI cannot be validated. */
class ReportSmokeFailure extends Data.TaggedError("ReportSmokeFailure")<{
  readonly operation: string
  readonly cause?: unknown
}> {}

const fail = (operation: string, cause?: unknown) => new ReportSmokeFailure({ operation, cause })

const runValidation = (repositoryRoot: string, bunExecutable: string, campaignId: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(
      ChildProcess.make(
        bunExecutable,
        [
          "x",
          "turbo",
          "run",
          "evals:validate",
          "--filter",
          "@better-native/dx-evals",
          "--concurrency=90%",
        ],
        {
          cwd: repositoryRoot,
          env: { BETTER_NATIVE_EVAL_RUN_ID: campaignId },
          extendEnv: true,
        },
      ),
    )
    const [output, exitCode] = yield* Effect.all(
      [Stream.mkString(handle.all.pipe(Stream.decodeText())), handle.exitCode] as const,
      { concurrency: "unbounded" },
    )
    if (Number(exitCode) !== 0) {
      return yield* fail("deterministic-eval-run", output.slice(-8_192))
    }
  }).pipe(Effect.mapError((cause) => fail("deterministic-eval-run", cause)))

/** Runs deterministic evals and proves their JSON can be served by the local report UI. */
export const run = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* Config.DxEvalConfig
    const crypto = yield* Crypto.Crypto
    const fs = yield* FileSystem.FileSystem
    const campaignId = `smoke-${yield* crypto.randomUUIDv4}`
    yield* runValidation(config.repositoryRoot, config.bunExecutable, campaignId)

    const reportPath = `${config.artifactsRoot}/${campaignId}/outputFile.json`
    const encoded = yield* fs
      .readFileString(reportPath)
      .pipe(Effect.mapError((cause) => fail("read-json-report", cause)))
    const report = yield* Schema.decodeUnknownEffect(JsonReport)(encoded).pipe(
      Effect.mapError((cause) => fail("decode-json-report", cause)),
    )
    if (!report.success || report.numFailedTests !== 0 || report.numTotalTests === 0) {
      return yield* fail("invalid-json-summary")
    }

    const candidateMetadata = report.testResults.flatMap(({ assertionResults }) =>
      assertionResults.flatMap(({ meta }) =>
        typeof meta === "object" && meta !== null && "harness" in meta ? [meta] : [],
      ),
    )
    const metadata = yield* Schema.decodeUnknownEffect(Schema.Array(HarnessMetadata))(
      candidateMetadata,
    ).pipe(Effect.mapError((cause) => fail("decode-eval-metadata", cause)))
    if (metadata.length === 0) return yield* fail("missing-eval-metadata")

    const server = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          serveReportUi({
            inputs: [reportPath],
            workspace: config.repositoryRoot,
            cwd: config.repositoryRoot,
            host: "127.0.0.1",
            port: 0,
          }),
        catch: (cause) => fail("start-report-ui", cause),
      }),
      (opened) => Effect.promise(() => opened.close()),
    )
    if (server.workspace.cases.length !== metadata.length) {
      return yield* fail("report-ui-case-count")
    }
    const response = yield* HttpClient.get(server.url).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError((cause) => fail("probe-report-ui", cause)),
    )
    const body = yield* response.text.pipe(
      Effect.mapError((cause) => fail("read-report-ui-response", cause)),
    )
    if (!body.includes("<!doctype html>")) return yield* fail("invalid-report-ui-response")
  }),
)
