import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import { RunId, TestSourceId } from "../Domain.ts"
import * as EvidenceStore from "../evidence/EvidenceStore.ts"
import { ExternalRunnerSupervisor, layer } from "./ExternalRunnerSupervisor.ts"
import { ProcessSupervisor } from "./ProcessSupervisor.ts"

describe("ExternalRunnerSupervisor", () => {
  it.effect("normalizes a failing runner report instead of losing its case failures", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-external-runner-" })
      const reportPath = `${root}/.artifacts/runs/external-run/external/jest.json`
      const processes = Layer.succeed(
        ProcessSupervisor,
        ProcessSupervisor.of({
          start: () => Effect.die("unexpected process start"),
          run: () =>
            fs
              .writeFileString(
                reportPath,
                JSON.stringify({
                  testResults: [
                    {
                      assertionResults: [
                        {
                          fullName: "network rejects",
                          status: "failed",
                          failureMessages: ["boom"],
                        },
                      ],
                    },
                  ],
                }),
              )
              .pipe(Effect.orDie, Effect.as({ exitCode: 1, observations: [] })),
        }),
      )
      const dependencies = Layer.mergeAll(processes, EvidenceStore.layer(root)).pipe(
        Layer.provideMerge(NodeServices.layer),
      )
      const program = Effect.gen(function* () {
        const supervisor = yield* ExternalRunnerSupervisor
        const results = yield* supervisor.run({
          reviewed: true,
          id: RunId.make("external-run"),
          runner: "jest",
          runId: RunId.make("external-run"),
          sourceId: TestSourceId.make("package-unit#packages/expo-network/test.ts"),
          commands: [{ command: "jest", args: [], timeoutMillis: 1_000 }],
          reportPath,
        })
        assert.lengthOf(results, 1)
        assert.strictEqual(results[0]?.outcome._tag, "failed")
        assert.isTrue(
          yield* fs.exists(`${root}/.artifacts/runs/external-run/external-results.json`),
        )
      }).pipe(Effect.provide(layer(root).pipe(Layer.provideMerge(dependencies))))
      yield* program
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect("rejects unapproved commands and paths outside the reviewed repository", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-external-policy-" })
      const outside = yield* fs.makeTempDirectoryScoped({
        prefix: "better-native-external-outside-",
      })
      const dependencies = Layer.mergeAll(
        Layer.succeed(
          ProcessSupervisor,
          ProcessSupervisor.of({
            start: () => Effect.die("unexpected process start"),
            run: () => Effect.succeed({ exitCode: 0, observations: [] }),
          }),
        ),
        EvidenceStore.layer(root),
      ).pipe(Layer.provideMerge(NodeServices.layer))
      const run = (command: string, cwd: string) =>
        Effect.gen(function* () {
          const supervisor = yield* ExternalRunnerSupervisor
          return yield* supervisor
            .run({
              reviewed: true,
              id: RunId.make("external-policy"),
              runner: "jest",
              runId: RunId.make("external-policy"),
              sourceId: TestSourceId.make("package-unit#policy"),
              commands: [{ command, args: [], cwd, timeoutMillis: 1_000 }],
              reportPath: `${root}/.artifacts/runs/external-policy/external/report.json`,
            })
            .pipe(Effect.flip)
        }).pipe(Effect.provide(layer(root).pipe(Layer.provideMerge(dependencies))))

      const commandFailure = yield* run("sh", root)
      assert.match(String(commandFailure.cause), /not an allowed/)
      const pathFailure = yield* run("jest", outside)
      assert.match(String(pathFailure.cause), /escapes/)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect("rejects symbolic-link and oversized reports", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      for (const scenario of ["link", "oversized"] as const) {
        const root = yield* fs.makeTempDirectoryScoped({
          prefix: `better-native-report-${scenario}-`,
        })
        const outside = yield* fs.makeTempDirectoryScoped({
          prefix: "better-native-report-outside-",
        })
        const reportPath = `${root}/.artifacts/runs/external-${scenario}/external/report.json`
        yield* fs.makeDirectory(`${root}/.artifacts/runs/external-${scenario}/external`, {
          recursive: true,
        })
        if (scenario === "link") {
          yield* fs.writeFileString(`${outside}/report.json`, "{}")
          yield* fs.symlink(`${outside}/report.json`, reportPath)
        } else {
          yield* fs.writeFile(reportPath, new Uint8Array(16 * 1024 * 1024 + 1))
        }
        const dependencies = Layer.mergeAll(
          Layer.succeed(
            ProcessSupervisor,
            ProcessSupervisor.of({
              start: () => Effect.die("unexpected process start"),
              run: () =>
                scenario === "oversized"
                  ? fs
                      .writeFile(reportPath, new Uint8Array(16 * 1024 * 1024 + 1))
                      .pipe(Effect.orDie, Effect.as({ exitCode: 0, observations: [] }))
                  : Effect.succeed({ exitCode: 0, observations: [] }),
            }),
          ),
          EvidenceStore.layer(root),
        ).pipe(Layer.provideMerge(NodeServices.layer))
        const failure = yield* Effect.gen(function* () {
          const supervisor = yield* ExternalRunnerSupervisor
          return yield* supervisor
            .run({
              reviewed: true,
              id: RunId.make(`external-${scenario}`),
              runner: "jest",
              runId: RunId.make(`external-${scenario}`),
              sourceId: TestSourceId.make("package-unit#report"),
              commands: [{ command: "jest", args: [], timeoutMillis: 1_000 }],
              reportPath,
            })
            .pipe(Effect.flip)
        }).pipe(Effect.provide(layer(root).pipe(Layer.provideMerge(dependencies))))
        assert.strictEqual(failure.phase, "report")
        assert.match(String(failure.cause), scenario === "link" ? /symbolic link/ : /no larger/)
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )

  it.effect("rejects repository source targets without deleting them", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-report-boundary-" })
      const manifest = `${root}/package.json`
      yield* fs.writeFileString(manifest, "preserve-me")
      const dependencies = Layer.mergeAll(
        Layer.succeed(
          ProcessSupervisor,
          ProcessSupervisor.of({
            start: () => Effect.die("unexpected process start"),
            run: () => Effect.die("unapproved report must fail before process execution"),
          }),
        ),
        EvidenceStore.layer(root),
      ).pipe(Layer.provideMerge(NodeServices.layer))
      const run = (reportPath: string) =>
        Effect.gen(function* () {
          const supervisor = yield* ExternalRunnerSupervisor
          return yield* supervisor
            .run({
              reviewed: true,
              id: RunId.make("source-boundary"),
              runner: "jest",
              runId: RunId.make("source-boundary"),
              sourceId: TestSourceId.make("package-unit#boundary"),
              commands: [{ command: "jest", args: [], timeoutMillis: 1_000 }],
              reportPath,
            })
            .pipe(Effect.flip)
        }).pipe(Effect.provide(layer(root).pipe(Layer.provideMerge(dependencies))))

      const sourceFailure = yield* run(manifest)
      assert.strictEqual(sourceFailure.phase, "report")
      assert.match(String(sourceFailure.cause), /report path must be/)
      assert.strictEqual(yield* fs.readFileString(manifest), "preserve-me")

      const extensionFailure = yield* run(
        `${root}/.artifacts/runs/source-boundary/external/report.xml`,
      )
      assert.strictEqual(extensionFailure.phase, "report")
      assert.match(String(extensionFailure.cause), /\.json/)
      assert.strictEqual(yield* fs.readFileString(manifest), "preserve-me")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  )
})
