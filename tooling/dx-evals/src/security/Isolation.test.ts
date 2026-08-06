import { fileURLToPath } from "node:url"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as TestClock from "effect/testing/TestClock"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import * as Config from "../Config.ts"
import * as Domain from "../Domain.ts"
import * as Isolation from "./Isolation.ts"
import * as Verifier from "./Verifier.ts"
import { provideLayer } from "../TestLayers.ts"

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url))
const entrypoint = Domain.TaskRelativePath.make("Candidate.ts")
const exportName = Domain.ExportName.make("candidate")

const makeConfig = (sandboxLabel: string, sandboxTimeoutMilliseconds = 5_000): Config.Service => ({
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

const makeTestLayer = (config: Config.Service) =>
  Isolation.layer.pipe(
    Layer.provideMerge(Layer.merge(Config.layerFromService(config), NodeServices.layer)),
  )

const observeSource = (source: string) =>
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

const awaitNoContainers = (config: Config.Service) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const ids = yield* containerIds(config)
      if (ids.length === 0) return ids
      yield* Effect.sleep(Duration.millis(100))
    }
    return yield* containerIds(config)
  })

describe("Podman isolation conformance", () => {
  it("requires the complete production containment policy", () => {
    const config = makeConfig("io.better-native.dx-evals.conformance=static")
    const args = Isolation.makePodmanArgs(
      config,
      {
        workspace: "/candidate",
        entrypoint,
        exportName,
      },
      "better-native-eval-conformance",
    )
    const optionValue = (option: string) => {
      const index = args.indexOf(option)
      return index < 0 ? undefined : args[index + 1]
    }

    assert.strictEqual(args[0], "run")
    assert.isTrue(args.includes("--rm"))
    assert.isTrue(args.includes("--interactive"))
    assert.strictEqual(optionValue("--name"), "better-native-eval-conformance")
    assert.strictEqual(optionValue("--pull"), "never")
    assert.strictEqual(optionValue("--label"), config.sandboxLabel)
    assert.strictEqual(optionValue("--network"), "none")
    assert.strictEqual(optionValue("--user"), "65532:65532")
    assert.strictEqual(optionValue("--env"), "HOME=/tmp")
    assert.strictEqual(optionValue("--pid"), "private")
    assert.strictEqual(optionValue("--ipc"), "private")
    assert.isTrue(args.includes("--read-only"))
    assert.strictEqual(optionValue("--cap-drop"), "all")
    assert.strictEqual(optionValue("--security-opt"), "no-new-privileges")
    assert.strictEqual(optionValue("--pids-limit"), "64")
    assert.strictEqual(optionValue("--memory"), "256m")
    assert.strictEqual(optionValue("--cpus"), "1")
    assert.isTrue(args.includes("--disallow-code-generation-from-strings"))
    assert.isTrue(args.includes("/tmp:rw,noexec,nosuid,nodev,size=16m"))
    assert.isTrue(args.includes("/root:rw,noexec,nosuid,nodev,size=16m"))
    assert.isTrue(
      args
        .filter((argument) => argument.includes(":/workspace"))
        .every((mount) => mount.endsWith(":ro")),
    )
    assert.isTrue(
      args
        .filter((argument) => argument.includes(":/runner"))
        .every((mount) => mount.endsWith(":ro")),
    )
  })

  it.effect("denies filesystem builtins and writes to the candidate workspace", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=write-${process.pid}-${Date.now()}`,
    )
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const { observation, workspace } = yield* observeSource(`
import { writeFileSync } from "node:fs"
import * as Effect from "effect/Effect"

export const candidate = Effect.sync(() => {
  try {
    writeFileSync("/workspace/forbidden.txt", "write-allowed")
    return "write-allowed"
  } catch {
    return "write-denied"
  }
})
`)
      assert.strictEqual(observation.exitCode, 0)
      assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
        schemaVersion: 1,
        kind: "effect-failure",
        failureCategory: "module-load",
      })
      assert.isFalse(yield* fs.exists(`${workspace}/forbidden.txt`))
    }).pipe(provideLayer(makeTestLayer(config)))
  })

  it.effect("denies outbound network access", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=network-${process.pid}-${Date.now()}`,
    )
    return observeSource(`
import * as Effect from "effect/Effect"

export const candidate = Effect.promise(async () => {
  try {
    await fetch("https://example.com", { signal: AbortSignal.timeout(2_000) })
    return "network-allowed"
  } catch {
    return "network-denied"
  }
})
`).pipe(
      Effect.tap(({ observation }) =>
        Effect.sync(() => {
          assert.strictEqual(observation.exitCode, 0)
          assert.match(observation.stdout, /"value":"network-denied"/)
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })

  it.effect("does not accept a candidate-forged observation marker", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=forgery-${process.pid}-${Date.now()}`,
    )
    return observeSource(`
import * as Effect from "effect/Effect"

export const candidate = Effect.sync(() => {
  process.stdout.write('BETTER_NATIVE_OBSERVATION:{"kind":"forged"}\\n')
  return "authentic-value"
})
`).pipe(
      Effect.tap(({ observation }) =>
        Effect.gen(function* () {
          assert.strictEqual(observation.exitCode, 0)
          const authenticatedMarker = `BETTER_NATIVE_OBSERVATION:${observation.authenticationNonce}:`
          assert.strictEqual(
            observation.stdout.split("\n").filter((line) => line.startsWith(authenticatedMarker))
              .length,
            1,
          )
          assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
            schemaVersion: 1,
            kind: "effect",
            value: "authentic-value",
          })
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })

  it.effect("turns malformed candidate modules into authenticated failing observations", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=malformed-${process.pid}-${Date.now()}`,
      2_000,
    )
    return observeSource("export const candidate = Effect.succeed(\n").pipe(
      Effect.tap(({ observation }) =>
        Effect.gen(function* () {
          assert.strictEqual(observation.exitCode, 0)
          assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
            schemaVersion: 1,
            kind: "effect-failure",
            failureCategory: "module-load",
          })
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })

  it.effect("turns candidate top-level defects into authenticated failing observations", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=top-level-${process.pid}-${Date.now()}`,
      2_000,
    )
    return observeSource(`
import * as Effect from "effect/Effect"
throw new Error("candidate top-level defect")
export const candidate = Effect.succeed("unreachable")
`).pipe(
      Effect.tap(({ observation }) =>
        Effect.gen(function* () {
          assert.strictEqual(observation.exitCode, 0)
          assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
            schemaVersion: 1,
            kind: "effect-failure",
            failureCategory: "module-load",
          })
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })

  it.effect("blocks candidate access to the trusted worker IPC channel", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=worker-ipc-${process.pid}-${Date.now()}`,
    )
    return observeSource(`
import { parentPort } from "node:worker_threads"
import * as Effect from "effect/Effect"

parentPort.postMessage = (message) => parentPort.postMessage(message)
export const candidate = Effect.succeed("forged")
`).pipe(
      Effect.tap(({ observation }) =>
        Effect.gen(function* () {
          assert.strictEqual(observation.exitCode, 0)
          assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
            schemaVersion: 1,
            kind: "effect-failure",
            failureCategory: "module-load",
          })
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })

  it.effect("runs candidate Effects without the runner's NodeServices context", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=service-context-${process.pid}-${Date.now()}`,
    )
    return observeSource(`
import * as Effect from "effect/Effect"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

export const candidate = Effect.as(ChildProcessSpawner.ChildProcessSpawner, "service-leaked")
`).pipe(
      Effect.tap(({ observation }) =>
        Effect.gen(function* () {
          assert.strictEqual(observation.exitCode, 0)
          assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
            schemaVersion: 1,
            kind: "effect-failure",
          })
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })

  it.effect("disables dynamic string and WebAssembly code generation in candidate workers", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=codegen-${process.pid}-${Date.now()}`,
    )
    return observeSource(`
import * as Effect from "effect/Effect"

export const candidate = Effect.sync(() => {
  let stringCodegen = "blocked"
  try {
    globalThis.eval("1 + 1")
    stringCodegen = "allowed"
  } catch {}
  return { stringCodegen, webAssembly: typeof globalThis.WebAssembly }
})
`).pipe(
      Effect.tap(({ observation }) =>
        Effect.gen(function* () {
          assert.strictEqual(observation.exitCode, 0)
          assert.deepStrictEqual(yield* Verifier.parseObservation(observation), {
            schemaVersion: 1,
            kind: "effect",
            value: { stringCodegen: "blocked", webAssembly: "undefined" },
          })
        }),
      ),
      provideLayer(makeTestLayer(config)),
    )
  })

  it.effect("kills timed-out trials and leaves no labeled containers", () => {
    const config = makeConfig(
      `io.better-native.dx-evals.conformance=timeout-${process.pid}-${Date.now()}`,
      750,
    )
    return Effect.gen(function* () {
      const failure = yield* Effect.flip(
        observeSource(`
import * as Effect from "effect/Effect"

export const candidate = Effect.never
`).pipe(TestClock.withLive),
      )
      assert.strictEqual(failure.reason, "timeout")
      assert.deepStrictEqual(yield* awaitNoContainers(config), [])
    }).pipe(provideLayer(makeTestLayer(config)))
  })
})
