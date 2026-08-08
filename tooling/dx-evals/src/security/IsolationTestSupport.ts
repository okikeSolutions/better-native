import { fileURLToPath } from "node:url"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import * as Config from "../Config.ts"
import * as Domain from "../Domain.ts"
import * as Isolation from "./Isolation.ts"

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url))

export const entrypoint = Domain.TaskRelativePath.make("Candidate.ts")
export const exportName = Domain.ExportName.make("candidate")

export const makeConfig = (
  sandboxLabel: string,
  sandboxTimeoutMilliseconds = 5_000,
): Config.Service => ({
  repositoryRoot,
  artifactsRoot: `${repositoryRoot}/.artifacts/evals`,
  effectPackageRoot: `${repositoryRoot}/node_modules/effect`,
  effectRuntimePackages: [
    { name: "fast-check", root: `${repositoryRoot}/node_modules/fast-check` },
    { name: "pure-rand", root: `${repositoryRoot}/node_modules/pure-rand` },
  ],
  runnerRuntimePackages: [
    {
      name: "@effect/platform-node",
      root: `${repositoryRoot}/node_modules/@effect/platform-node`,
    },
    {
      name: "@effect/platform-node-shared",
      root: `${repositoryRoot}/node_modules/@effect/platform-node-shared`,
    },
  ],
  evalRunnerRoot: `${repositoryRoot}/tooling/dx-evals/runner`,
  podmanExecutable: "podman",
  bunExecutable: "bun",
  tarExecutable: "tar",
  sandboxImage:
    "docker.io/library/node@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd",
  sandboxLabel,
  sandboxTimeoutMilliseconds,
})

export const makeTestLayer = (config: Config.Service) =>
  Isolation.layer.pipe(
    Layer.provideMerge(Layer.merge(Config.layerFromService(config), NodeServices.layer)),
  )

export const observeSource = (source: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const config = yield* Config.DxEvalConfig
      const isolation = yield* Isolation.Isolation
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const workspaceParent = path.join(config.artifactsRoot, "workspaces")
      yield* fs.makeDirectory(workspaceParent, { recursive: true })
      const workspace = yield* fs.makeTempDirectoryScoped({
        directory: workspaceParent,
        prefix: "isolation-conformance-",
      })
      yield* fs.chmod(workspace, 0o755)
      yield* fs.writeFileString(path.join(workspace, entrypoint), source)
      const observation = yield* isolation.observe({ workspace, entrypoint, exportName })
      return { observation, workspace }
    }),
  )

const containerIds = (config: Config.Service) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const output = yield* spawner.string(
      ChildProcess.make(config.podmanExecutable, [
        "ps",
        "--all",
        "--filter",
        `label=${config.sandboxLabel}`,
        "--format",
        "{{.ID}}",
      ]),
    )
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  })

export const awaitNoContainers = (config: Config.Service) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const ids = yield* containerIds(config)
      if (ids.length === 0) return ids
      yield* Effect.sleep(Duration.millis(100))
    }
    return yield* containerIds(config)
  })
