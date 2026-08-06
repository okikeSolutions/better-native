import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Config from "../Config.ts"
import * as Domain from "../Domain.ts"
import * as Isolation from "../security/Isolation.ts"
import * as Submission from "../security/Submission.ts"
import { exportTask, makeAgentWorkspaceSeed, materializeCandidate } from "./TaskWorkspace.ts"
import * as Battery from "./Battery.ts"
import * as Network from "./Network.ts"
import * as PackageArtifact from "./PackageArtifact.ts"
import * as Synthetic from "./Synthetic.ts"
import { provideLayer } from "../TestLayers.ts"

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url))
const platformLayer = Layer.merge(Config.layer(repositoryRoot), NodeServices.layer)
const baseLayer = PackageArtifact.layer.pipe(Layer.provideMerge(platformLayer))

const validateEmptySubmission = (entrypoint: Domain.TaskRelativePath) =>
  Submission.validateSubmission(
    { entries: [] },
    {
      allowedPaths: new Set([entrypoint]),
      maxFiles: 4,
      maxFileBytes: 64 * 1024,
      maxTotalBytes: 128 * 1024,
    },
  )

describe("synthetic task boundary", () => {
  it.effect("withholds references, broken examples, and grader data from the trial export", () =>
    Effect.gen(function* () {
      const task = yield* Synthetic.load
      const paths = exportTask(task).files.map((file) => file.path)
      const seed = yield* makeAgentWorkspaceSeed(task)
      const seedPaths = seed.files.map((file) => String(file.path))
      assert.deepStrictEqual(paths, ["instruction.md", "task.json", "fixture/src/Greeting.ts"])
      assert.deepStrictEqual(
        seedPaths.filter((path) => !path.startsWith("node_modules/effect/")),
        ["instruction.md", "task.json", "src/Greeting.ts"],
      )
      assert.include(seedPaths, "node_modules/effect/package.json")
      assert.include(seedPaths, "node_modules/effect/dist/Effect.d.ts")
      assert.isTrue(seed.editablePaths.has(task.definition.entrypoint))
      assert.strictEqual(seed.packageDigests.size, 0)
      assert.isFalse(paths.some((path) => /grader|reference|broken/i.test(path)))
      assert.isFalse(
        seedPaths
          .filter((path) => !path.startsWith("node_modules/effect/"))
          .some((path) => /grader|reference|broken/i.test(path)),
      )
    }).pipe(provideLayer(baseLayer)),
  )

  it.effect("verifies from a pristine clean-room workspace without mounting withheld files", () => {
    const fakeIsolation = Isolation.layerFromService({
      observe: (request) =>
        Effect.sync(() => {
          const source = readFileSync(`${request.workspace}/src/Greeting.ts`, "utf8")
          assert.include(source, 'Effect.succeed("hello, effect")')
          assert.isFalse(existsSync(`${request.workspace}/grader`))
          assert.isFalse(existsSync(`${request.workspace}/reference.patch`))
          return {
            authenticationNonce: "test-nonce",
            exitCode: 0,
            stdout:
              'BETTER_NATIVE_OBSERVATION:test-nonce:{"schemaVersion":1,"kind":"effect","value":"hello, effect"}\n',
            stderr: "",
            truncated: false,
          }
        }),
    })
    const layer = fakeIsolation.pipe(Layer.provideMerge(baseLayer))
    return Effect.gen(function* () {
      const task = yield* Synthetic.load
      const result = yield* Synthetic.verifySubmission(task, {
        entries: [
          {
            kind: "file",
            path: "src/Greeting.ts",
            content:
              'import * as Effect from "effect/Effect"\n\nexport const greeting = Effect.succeed("hello, effect")\n',
          },
        ],
      })
      assert.isTrue(result.passed)
    }).pipe(provideLayer(layer))
  })
})

describe("Battery task boundary", () => {
  it.effect("rejects duplicate grader scenarios", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Battery.validateScenarioIds([
          "two-events",
          "early-stop",
          "listener-failure",
          "listener-failure",
        ]),
      )
      assert.strictEqual(result._tag, "Failure")
    }),
  )

  it.effect("exports the reactive fixture and public package identity but withholds controls", () =>
    Effect.gen(function* () {
      const task = yield* Battery.load
      const taskExport = exportTask(task)
      const paths = taskExport.files.map((file) => file.path)

      assert.deepStrictEqual(paths, [
        "instruction.md",
        "task.json",
        "fixture/src/ObserveBattery.ts",
      ])
      assert.deepStrictEqual(taskExport.publicPackages, ["@better-native/battery"])
      assert.isFalse(
        paths
          .filter((path) => !path.startsWith("node_modules/effect/"))
          .some((path) => /grader|reference|broken|double/i.test(path)),
      )
    }).pipe(provideLayer(baseLayer)),
  )

  it.effect(
    "binds the Battery double and runtime configuration into private evaluator evidence",
    () =>
      Effect.gen(function* () {
        const task = yield* Battery.load
        const paths = task.evaluatorBundle.map((file) => String(file.path))

        assert.include(paths, "tooling/dx-evals/src/Config.ts")
        assert.include(paths, "tooling/dx-evals/src/agent/CompileCheck.ts")
        assert.include(paths, "tooling/dx-evals/src/security/Isolation.ts")
        assert.include(paths, "tooling/dx-evals/src/security/Submission.ts")
        assert.include(paths, "tooling/dx-evals/src/security/Verifier.ts")
        assert.include(paths, "tooling/dx-evals/fixtures/expo-battery/package.json")
        assert.include(paths, "tooling/dx-evals/fixtures/expo-battery/index.js")
        assert.include(paths, "tooling/dx-evals/fixtures/expo-battery/index.d.ts")
      }).pipe(provideLayer(baseLayer)),
  )

  it.effect("gives agents the packed public manifest and complete Battery declaration graph", () =>
    Effect.gen(function* () {
      const task = yield* Battery.load
      const seed = yield* makeAgentWorkspaceSeed(task)
      const paths = seed.files.map((file) => String(file.path))
      const declarations = seed.files.find((file) => file.path.endsWith("build/index.d.ts"))

      assert.deepStrictEqual(
        paths.filter((path) => !path.startsWith("node_modules/effect/")),
        [
          "instruction.md",
          "task.json",
          "src/ObserveBattery.ts",
          "public-packages/@better-native/battery/package.json",
          "public-packages/@better-native/battery/build/Battery.d.ts",
          "public-packages/@better-native/battery/build/Expo.d.ts",
          "public-packages/@better-native/battery/build/index.d.ts",
        ],
      )
      assert.include(paths, "node_modules/effect/package.json")
      assert.include(paths, "node_modules/effect/dist/Effect.d.ts")
      assert.include(paths, "node_modules/effect/dist/Schema.d.ts")
      assert.include(paths, "node_modules/effect/dist/Stream.d.ts")
      assert.isFalse(paths.some((path) => path.startsWith("node_modules/effect/dist/internal/")))
      assert.isTrue(seed.editablePaths.has(task.definition.entrypoint))
      assert.include(declarations?.content ?? "", 'export * as Battery from "./Battery.ts"')
      assert.isTrue(seed.packageDigests.has("@better-native/battery"))
      assert.isFalse(paths.some((path) => path.endsWith(".js") || path.endsWith(".js.map")))
      assert.isFalse(
        paths
          .filter((path) => !path.startsWith("node_modules/effect/"))
          .some((path) => /grader|reference|broken|double/i.test(path)),
      )
    }).pipe(provideLayer(baseLayer)),
  )

  it.effect(
    "uses one Battery artifact digest for agent discovery and clean-room installation",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const agentTask = yield* Battery.load
          const artifacts = yield* PackageArtifact.PackageArtifacts
          const firstArtifact = yield* artifacts.prepare(agentTask.packedPackage!)
          const seed = yield* makeAgentWorkspaceSeed(agentTask)
          const verifierTask = yield* Battery.load
          const submission = yield* validateEmptySubmission(verifierTask.definition.entrypoint)
          const workspace = yield* materializeCandidate(verifierTask, submission)
          const reusedArtifact = yield* artifacts.prepare(verifierTask.packedPackage!)

          assert.isTrue(existsSync(firstArtifact.archivePath))
          assert.strictEqual(firstArtifact.archivePath, reusedArtifact.archivePath)
          assert.strictEqual(
            seed.packageDigests.get("@better-native/battery"),
            workspace.packageDigest,
          )
          assert.isFalse(existsSync(`${workspace.root}/node_modules/@better-native/battery/src`))
        }),
      ).pipe(provideLayer(baseLayer)),
  )
})

describe("Network task boundary", () => {
  it.effect("rejects duplicate grader scenarios", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Network.validateScenarioIds([
          "available",
          "unavailable",
          "failure",
          "malformed",
          "malformed",
        ]),
      )
      assert.strictEqual(result._tag, "Failure")
    }),
  )

  it.effect("exports the consumer fixture and public package identity but withholds controls", () =>
    Effect.gen(function* () {
      const task = yield* Network.load
      const taskExport = exportTask(task)
      const paths = taskExport.files.map((file) => file.path)

      assert.deepStrictEqual(paths, ["instruction.md", "task.json", "fixture/src/ReadNetwork.ts"])
      assert.deepStrictEqual(taskExport.publicPackages, ["@better-native/network"])
      assert.isFalse(
        paths
          .filter((path) => !path.startsWith("node_modules/effect/"))
          .some((path) => /grader|reference|broken|double/i.test(path)),
      )
    }).pipe(provideLayer(baseLayer)),
  )

  it.effect(
    "binds the Network double and runtime configuration into private evaluator evidence",
    () =>
      Effect.gen(function* () {
        const task = yield* Network.load
        const paths = task.evaluatorBundle.map((file) => String(file.path))

        assert.include(paths, "tooling/dx-evals/src/Config.ts")
        assert.include(paths, "tooling/dx-evals/src/agent/CompileCheck.ts")
        assert.include(paths, "tooling/dx-evals/src/security/Isolation.ts")
        assert.include(paths, "tooling/dx-evals/src/security/Submission.ts")
        assert.include(paths, "tooling/dx-evals/src/security/Verifier.ts")
        assert.include(paths, "tooling/dx-evals/fixtures/expo-network/package.json")
        assert.include(paths, "tooling/dx-evals/fixtures/expo-network/index.js")
        assert.include(paths, "tooling/dx-evals/fixtures/expo-network/index.d.ts")
      }).pipe(provideLayer(baseLayer)),
  )

  it.effect("gives agents the packed public manifest and complete Network declaration graph", () =>
    Effect.gen(function* () {
      const task = yield* Network.load
      const seed = yield* makeAgentWorkspaceSeed(task)
      const paths = seed.files.map((file) => String(file.path))
      const declarations = seed.files.find((file) => file.path.endsWith("build/index.d.ts"))

      assert.deepStrictEqual(
        paths.filter((path) => !path.startsWith("node_modules/effect/")),
        [
          "instruction.md",
          "task.json",
          "src/ReadNetwork.ts",
          "public-packages/@better-native/network/package.json",
          "public-packages/@better-native/network/build/Expo.d.ts",
          "public-packages/@better-native/network/build/Network.d.ts",
          "public-packages/@better-native/network/build/index.d.ts",
        ],
      )
      assert.include(paths, "node_modules/effect/package.json")
      assert.include(paths, "node_modules/effect/dist/Effect.d.ts")
      assert.include(paths, "node_modules/effect/dist/Match.d.ts")
      assert.include(paths, "node_modules/effect/dist/Schema.d.ts")
      assert.isFalse(paths.some((path) => path.startsWith("node_modules/effect/dist/internal/")))
      assert.isTrue(seed.editablePaths.has(task.definition.entrypoint))
      assert.include(declarations?.content ?? "", 'export * as Network from "./Network.ts"')
      assert.isTrue(seed.packageDigests.has("@better-native/network"))
      assert.isFalse(paths.some((path) => path.endsWith(".js") || path.endsWith(".js.map")))
      assert.isFalse(
        paths
          .filter((path) => !path.startsWith("node_modules/effect/"))
          .some((path) => /grader|reference|broken|double/i.test(path)),
      )
    }).pipe(provideLayer(baseLayer)),
  )

  it.effect(
    "uses one Network artifact digest for agent discovery and clean-room installation",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const agentTask = yield* Network.load
          const artifacts = yield* PackageArtifact.PackageArtifacts
          const firstArtifact = yield* artifacts.prepare(agentTask.packedPackage!)
          const seed = yield* makeAgentWorkspaceSeed(agentTask)
          const verifierTask = yield* Network.load
          const submission = yield* validateEmptySubmission(verifierTask.definition.entrypoint)
          const workspace = yield* materializeCandidate(verifierTask, submission)
          const reusedArtifact = yield* artifacts.prepare(verifierTask.packedPackage!)

          assert.isTrue(existsSync(firstArtifact.archivePath))
          assert.strictEqual(firstArtifact.archivePath, reusedArtifact.archivePath)
          assert.strictEqual(
            seed.packageDigests.get("@better-native/network"),
            workspace.packageDigest,
          )
          assert.isFalse(existsSync(`${workspace.root}/node_modules/@better-native/network/src`))
        }),
      ).pipe(provideLayer(baseLayer)),
  )
})
