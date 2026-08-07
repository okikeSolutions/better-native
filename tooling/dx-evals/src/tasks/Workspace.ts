import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Config from "../Config.ts"
import * as ArtifactStore from "../evidence/ArtifactStore.ts"
import * as Domain from "../Domain.ts"
import type { ValidatedSubmission } from "../security/Submission.ts"
import * as PackageArtifact from "./PackageArtifact.ts"
import type * as TaskModel from "./TaskModel.ts"

export { TaskBundleInvalid } from "./PackageArtifact.ts"
import { TaskBundleInvalid } from "./PackageArtifact.ts"

const parseJson = (value: string): Effect.Effect<unknown, TaskBundleInvalid> =>
  Effect.try({
    try: () => JSON.parse(value) as unknown,
    catch: () => new TaskBundleInvalid({ reason: "invalid-json" }),
  })

/** Decodes repository-owned JSON and maps parse or schema errors to one task-bundle failure. */
export const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: string,
  reason: string,
): Effect.Effect<S["Type"], TaskBundleInvalid> =>
  parseJson(value).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(() => new TaskBundleInvalid({ reason })),
  )

/** Rejects missing, unknown-by-schema, or duplicate rows in a closed scenario matrix. */
export const validateScenarioIds = <Id extends string>(
  actual: ReadonlyArray<Id>,
  expected: ReadonlyArray<Id>,
  reason: string,
): Effect.Effect<void, TaskBundleInvalid> => {
  const unique = new Set(actual)
  return actual.length === expected.length &&
    unique.size === expected.length &&
    expected.every((id) => unique.has(id))
    ? Effect.void
    : Effect.fail(new TaskBundleInvalid({ reason }))
}

/** Reads the conventional files shared by every checked-in task bundle. */
export const readTaskFiles = (directory: string, fixturePath: Domain.TaskRelativePath) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = path.join(directory)
    const [instruction, fixtureSource, encodedDefinition, encodedExpected] = yield* Effect.all([
      fs.readFileString(path.join(root, "instruction.md")),
      fs.readFileString(path.join(root, "fixture", fixturePath)),
      fs.readFileString(path.join(root, "task.json")),
      fs.readFileString(path.join(root, "grader", "expected.json")),
    ])
    return {
      root,
      instruction,
      fixtureSource,
      encodedDefinition,
      encodedExpected,
    }
  })

/** Reads the private implementation inputs whose digest makes an eval decision reproducible. */
export const readEvaluatorBundle = (
  taskName: string,
  taskModule: string,
  runnerStem: "effect" | "network" | "battery" | "keep-awake",
) =>
  Effect.gen(function* () {
    const config = yield* Config.DxEvalConfig
    const fs = yield* FileSystem.FileSystem
    const controlledDoublePaths = Match.value(runnerStem).pipe(
      Match.when("effect", () => []),
      Match.whenOr("network", "battery", "keep-awake", (nativeModule) => [
        `tooling/dx-evals/fixtures/expo-${nativeModule}/package.json`,
        `tooling/dx-evals/fixtures/expo-${nativeModule}/index.js`,
        `tooling/dx-evals/fixtures/expo-${nativeModule}/index.d.ts`,
      ]),
      Match.exhaustive,
    )
    const paths = [
      `evals/tasks/${taskName}/grader/expected.json`,
      "tooling/dx-evals/src/Config.ts",
      "tooling/dx-evals/src/agent/CompileCheck.ts",
      `tooling/dx-evals/src/tasks/${taskModule}`,
      "tooling/dx-evals/src/tasks/PackageArtifact.ts",
      "tooling/dx-evals/src/tasks/SourcePolicy.ts",
      "tooling/dx-evals/src/tasks/Workspace.ts",
      "tooling/dx-evals/src/security/Submission.ts",
      "tooling/dx-evals/src/security/Verifier.ts",
      "tooling/dx-evals/src/security/Isolation.ts",
      "tooling/dx-evals/runner/Protocol.ts",
      "tooling/dx-evals/runner/CompileDiagnostics.ts",
      "tooling/dx-evals/runner/check-types.ts",
      "tooling/dx-evals/runner/Supervisor.ts",
      "tooling/dx-evals/runner/Runtime.ts",
      "tooling/dx-evals/runner/WorkerSupport.ts",
      `tooling/dx-evals/runner/observe-${runnerStem}.ts`,
      `tooling/dx-evals/runner/worker-${runnerStem}.ts`,
      "tooling/dx-evals/package.json",
      "package.json",
      "bun.lock",
      ...controlledDoublePaths,
    ]
    return yield* Effect.forEach(paths, (relativePath) =>
      fs.readFileString(`${config.repositoryRoot}/${relativePath}`).pipe(
        Effect.map((content) => ({
          path: Domain.TaskRelativePath.make(relativePath),
          content,
        })),
      ),
    )
  })

/** Exports instructions, public metadata, fixtures, and declared public package identities. */
export const exportTask = (task: TaskModel.TaskBase): TaskModel.TaskExport => ({
  files: [
    {
      path: Domain.TaskRelativePath.make("instruction.md"),
      content: task.instruction,
    },
    {
      path: Domain.TaskRelativePath.make("task.json"),
      content: `${JSON.stringify(task.definition, null, 2)}\n`,
    },
    ...task.fixtureFiles.map((file) => ({
      path: Domain.TaskRelativePath.make(`fixture/${file.path}`),
      content: file.content,
    })),
  ],
  publicPackages: task.publicPackages,
})

const readPublicEffectSurface = Effect.gen(function* () {
  const config = yield* Config.DxEvalConfig
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const declarationRoot = path.join(config.effectPackageRoot, "dist")
  const declarationNames = (yield* fs.readDirectory(declarationRoot))
    .filter((name) => /\.d\.(?:ts|mts|cts)$/.test(name))
    .toSorted()
  const declarations = yield* Effect.forEach(
    declarationNames,
    (name) =>
      fs.readFileString(path.join(declarationRoot, name)).pipe(
        Effect.map((content) => ({
          path: Domain.TaskRelativePath.make(`node_modules/effect/dist/${name}`),
          content,
        })),
      ),
    { concurrency: 16 },
  )
  return [
    {
      path: Domain.TaskRelativePath.make("node_modules/effect/package.json"),
      content: yield* fs.readFileString(path.join(config.effectPackageRoot, "package.json")),
    },
    ...declarations,
  ] satisfies ReadonlyArray<TaskModel.FixtureFile>
})

/** Builds the virtual workspace exposed through coding-agent tools. */
export const makeAgentWorkspaceSeed = (task: TaskModel.TaskBase) =>
  Effect.gen(function* () {
    const files: Array<TaskModel.FixtureFile> = [
      {
        path: Domain.TaskRelativePath.make("instruction.md"),
        content: task.instruction,
      },
      {
        path: Domain.TaskRelativePath.make("task.json"),
        content: `${JSON.stringify(task.definition, null, 2)}\n`,
      },
      ...task.fixtureFiles,
      ...(yield* readPublicEffectSurface),
    ]
    const packageDigests = new Map<string, Domain.Sha256Digest>()
    if (task.packedPackage !== null) {
      const artifacts = yield* PackageArtifact.PackageArtifacts
      const artifact = yield* artifacts.prepare(task.packedPackage)
      packageDigests.set(task.packedPackage.packageName, artifact.digest)
      files.push(
        ...artifact.publicFiles.map((file) => ({
          path: Domain.TaskRelativePath.make(
            `public-packages/${task.packedPackage!.packageName}/${file.path}`,
          ),
          content: file.content,
        })),
      )
    }
    return {
      files,
      editablePaths: new Set(task.definition.allowedSubmissionPaths),
      packageDigests,
    } satisfies TaskModel.AgentWorkspaceSeed
  })

const installPackedPackage = (workspace: string, spec: TaskModel.PackedPackageSpec) =>
  Effect.gen(function* () {
    const config = yield* Config.DxEvalConfig
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const artifacts = yield* PackageArtifact.PackageArtifacts
    const artifact = yield* artifacts.prepare(spec)
    const installedRoot = yield* artifacts.install(artifact, workspace)
    if (yield* fs.exists(path.join(installedRoot, "src"))) {
      return yield* new TaskBundleInvalid({
        reason: `private-${spec.taskName}-package-entry`,
      })
    }
    const doubleSource = path.join(
      config.repositoryRoot,
      "tooling",
      "dx-evals",
      "fixtures",
      spec.nativeDouble,
    )
    // Nest the controlled native module below the packed public package. Package internals can
    // resolve it, while a candidate entrypoint cannot import the double as a top-level dependency.
    const doubleRoot = path.join(installedRoot, "node_modules", spec.nativeDouble)
    yield* fs.makeDirectory(doubleRoot, { recursive: true })
    yield* fs.copyFile(
      path.join(doubleSource, "package.json"),
      path.join(doubleRoot, "package.json"),
    )
    yield* fs.copyFile(path.join(doubleSource, "index.js"), path.join(doubleRoot, "index.js"))
    yield* fs.copyFile(path.join(doubleSource, "index.d.ts"), path.join(doubleRoot, "index.d.ts"))
    return artifact.digest
  })

/** Reconstructs a clean candidate workspace from pristine fixtures and validated changed files. */
export const materializeCandidate = (task: TaskModel.TaskBase, submission: ValidatedSubmission) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const workspaceRoot = yield* ArtifactStore.ensureDirectory("workspaces")
    const root = yield* fs.makeTempDirectoryScoped({
      directory: workspaceRoot,
      prefix: "trial-",
    })
    yield* fs.writeFileString(
      path.join(root, "package.json"),
      '{"name":"@better-native/dx-eval-candidate","private":true,"type":"module"}\n',
    )
    for (const file of task.fixtureFiles) {
      yield* fs.makeDirectory(path.dirname(path.join(root, file.path)), {
        recursive: true,
      })
      yield* fs.writeFileString(path.join(root, file.path), file.content)
    }
    for (const entry of submission.entries) {
      yield* fs.makeDirectory(path.dirname(path.join(root, entry.path)), {
        recursive: true,
      })
      yield* fs.writeFileString(path.join(root, entry.path), entry.content)
    }
    const packageDigest = yield* Match.value(task.packedPackage).pipe(
      Match.when(null, () => Effect.succeed(null)),
      Match.when(
        (spec): spec is TaskModel.PackedPackageSpec => spec !== null,
        (spec) => installPackedPackage(root, spec),
      ),
      Match.exhaustive,
    )
    return {
      root,
      packageSource: Match.value(packageDigest).pipe(
        Match.when(null, () => "none" as const),
        Match.when(
          (digest): digest is Domain.Sha256Digest => digest !== null,
          () => "packed-public-package" as const,
        ),
        Match.exhaustive,
      ),
      packageDigest,
    } satisfies TaskModel.CandidateWorkspace
  })
