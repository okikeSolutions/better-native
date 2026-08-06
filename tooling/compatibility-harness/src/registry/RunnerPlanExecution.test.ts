import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import { TestCaseId } from "../Domain.ts"
import { provideLayer } from "../TestLayers.ts"
import * as ExpoRepository from "../ExpoRepository.ts"
import * as HarnessConfig from "../HarnessConfig.ts"
import * as RunnerPlanExecution from "./RunnerPlanExecution.ts"
import * as Suites from "../suites/Suites.ts"
import { ExternalRunnerSupervisor } from "../supervision/ExternalRunnerSupervisor.ts"

describe("RunnerPlanExecution", () => {
  it("expands repository, Expo and run templates", () => {
    assert.strictEqual(
      RunnerPlanExecution.expandTemplate(
        "{repositoryRoot}/out/{runId}:{expoRoot}",
        "/repository",
        "/external/expo",
        "run-1",
      ),
      "/repository/out/run-1:/external/expo",
    )
  })

  it.effect("supervises a generated shard and writes complete shard accounting", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-runner-plan-" })
      const output = `${directory}/runner-plan.json`
      const corpus = yield* Suites.discover()
      const supervisedRequests: Array<{
        readonly sourceId: string
        readonly command: string
        readonly cwd: string | undefined
        readonly reportPath: string
      }> = []
      const casesBySource = new Map(
        corpus.sources.map((source) => [
          source.id,
          corpus.cases.filter(({ sourceId }) => sourceId === source.id).map(({ id }) => id),
        ]),
      )
      const supervisor = Layer.succeed(
        ExternalRunnerSupervisor,
        ExternalRunnerSupervisor.of({
          run: (request) => {
            supervisedRequests.push({
              sourceId: request.sourceId,
              command: request.commands[0]?.command ?? "",
              cwd: request.commands[0]?.cwd,
              reportPath: request.reportPath,
            })
            const staticCases = casesBySource.get(request.sourceId) ?? []
            const caseIds =
              staticCases.length > 0
                ? staticCases
                : [TestCaseId.make(`${request.sourceId}#runtime-discovered@1`)]
            return Effect.succeed(
              caseIds.map((caseId) => ({
                schemaVersion: 1 as const,
                runId: request.runId,
                caseId,
                attempt: 1,
                outcome: { _tag: "passed" as const, durationMillis: 1 },
                artifacts: [],
              })),
            )
          },
        }),
      )
      const report = yield* RunnerPlanExecution.run({
        runner: "bun-test",
        shardIndex: 0,
        shardCount: 4,
        timeoutMillis: 1_000,
        reportPath: output,
      }).pipe(provideLayer(supervisor))
      assert.strictEqual(report.entries.filter(({ status }) => status === "passed").length, 1)
      assert.strictEqual(report.entries.filter(({ status }) => status === "failed").length, 0)
      assert.isAbove(report.entries.filter(({ status }) => status === "blocked").length, 0)
      assert.isAbove(report.entries.filter(({ status }) => status === "not-run").length, 0)
      assert.lengthOf(supervisedRequests, 1)
      assert.strictEqual(supervisedRequests[0]?.command, "bun")
      assert.notInclude(supervisedRequests[0]?.cwd ?? "", "{")
      assert.notInclude(supervisedRequests[0]?.reportPath ?? "", "{")
      assert.isTrue(yield* fs.exists(output))
      const persisted = yield* fs.readFileString(output)
      assert.deepEqual(JSON.parse(persisted), report)
    }).pipe(
      Effect.scoped,
      provideLayer(
        ExpoRepository.layer(process.cwd()).pipe(
          Layer.provideMerge(
            Layer.merge(
              NodeServices.layer,
              HarnessConfig.layer(process.cwd()).pipe(Layer.provide(NodeServices.layer)),
            ),
          ),
        ),
      ),
    ),
  )
})
