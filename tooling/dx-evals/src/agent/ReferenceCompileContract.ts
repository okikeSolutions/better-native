import { fileURLToPath } from "node:url"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as CompileCheck from "./CompileCheck.ts"
import * as Config from "../Config.ts"
import * as Isolation from "../security/Isolation.ts"
import * as Submission from "../security/Submission.ts"
import * as PackageArtifact from "../tasks/PackageArtifact.ts"
import type * as TaskModel from "../tasks/TaskModel.ts"

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url))
const platformLayer = Layer.merge(Config.layer(repositoryRoot), NodeServices.layer)
const packageLayer = PackageArtifact.layer.pipe(Layer.provideMerge(platformLayer))

/** Production compiler dependencies shared by independently schedulable package contracts. */
export const liveLayer = Isolation.layer.pipe(Layer.provideMerge(packageLayer))

/** Ensures public compiler diagnostics do not reveal trusted host or sandbox paths. */
export const assertDiagnosticsSanitized = (
  diagnostics: ReadonlyArray<{ readonly message: string }>,
) => {
  for (const diagnostic of diagnostics) {
    assert.notInclude(diagnostic.message, "/workspace")
    assert.notInclude(diagnostic.message, "/runner")
    assert.notInclude(diagnostic.message, repositoryRoot)
  }
}

/** Proves that one task's reviewed reference compiles through the public isolation boundary. */
export const assertReferenceCompiles = (task: TaskModel.TaskBase) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const patch = yield* fs.readFileString(path.join(task.root, "reference.patch"))
    const content = yield* Submission.applySingleFilePatch(
      task.fixtureFiles[0]!.content,
      patch,
      task.definition.entrypoint,
    )
    const result = yield* CompileCheck.checkSubmission(task, {
      entries: [{ kind: "file", path: task.definition.entrypoint, content }],
    })

    assert.deepStrictEqual(result, {
      status: "passed",
      diagnostics: [],
      truncated: false,
    })
  })
