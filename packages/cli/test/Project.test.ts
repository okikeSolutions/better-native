import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { afterEach, assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Environment from "../src/Environment.ts"
import { CliFailure } from "../src/Model.ts"
import * as Project from "../src/Project.ts"

/* oxlint-disable effecttsgo/strict-effect-provide -- test runtime boundary */

let roots: Array<string> = []

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots = []
})

const fixture = async (options?: {
  readonly projectManifest?: string
  readonly expoManifest?: string | null
  readonly cli?: boolean
}) => {
  const root = await mkdtemp(join(tmpdir(), "better-native-cli-"))
  roots.push(root)
  await mkdir(join(root, "nested"), { recursive: true })
  await writeFile(
    join(root, "package.json"),
    options?.projectManifest ?? JSON.stringify({ dependencies: { expo: "57.0.9" } }),
  )
  if (options?.expoManifest !== null) {
    await mkdir(join(root, "node_modules/expo/bin"), { recursive: true })
    await writeFile(
      join(root, "node_modules/expo/package.json"),
      options?.expoManifest ?? JSON.stringify({ version: "57.0.9" }),
    )
    if (options?.cli !== false) await writeFile(join(root, "node_modules/expo/bin/cli"), "")
  }
  return root
}

const service = (cwd: string) => {
  const environment = Environment.layer({ cwd, nodeExecutable: process.execPath })
  const infrastructure = Layer.merge(NodeServices.layer, environment)
  return Project.layer.pipe(Layer.provide(infrastructure))
}

const inspect = (cwd: string) =>
  Effect.gen(function* () {
    const project = yield* Project.Project
    return yield* project.inspect
  }).pipe(Effect.provide(service(cwd)))

const expectFailure = async (effect: Effect.Effect<unknown, CliFailure>) => {
  const exit = await Effect.runPromiseExit(effect)
  assert.strictEqual(exit._tag, "Failure")
  if (exit._tag !== "Failure") throw new Error("expected failure")
  const reason = exit.cause.reasons[0]
  assert.strictEqual(reason?._tag, "Fail")
  if (reason?._tag !== "Fail") throw new Error("expected typed failure")
  return reason.error
}

describe("CLI project inspection", () => {
  it("finds an ancestor Expo project and detects each lockfile family", async () => {
    const root = await fixture()
    for (const lockfile of [
      "bun.lock",
      "bun.lockb",
      "yarn.lock",
      "package-lock.json",
      "pnpm-lock.yaml",
    ]) {
      await writeFile(join(root, lockfile), "")
    }
    const project = await Effect.runPromise(inspect(join(root, "nested")))
    assert.strictEqual(project.root, root)
    assert.strictEqual(project.expoVersion, "57.0.9")
    assert.deepEqual(project.lockfileManagers, ["bun", "yarn", "npm", "pnpm"])
  })

  it("reads installed scoped package manifests", async () => {
    const root = await fixture()
    const path = join(root, "node_modules/@better-native/clipboard/package.json")
    await mkdir(join(root, "node_modules/@better-native/clipboard"), { recursive: true })
    await writeFile(path, JSON.stringify({ version: "0.0.1-alpha.1" }))
    const manifest = await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* Project.Project
        assert.strictEqual(project.installedManifestPath(root, "@better-native/clipboard"), path)
        return yield* project.readInstalledManifest(root, "@better-native/clipboard")
      }).pipe(Effect.provide(service(root))),
    )
    assert.strictEqual(manifest.version, "0.0.1-alpha.1")
  })

  it("rejects malformed project and installed manifests", async () => {
    const malformedProject = await fixture({ projectManifest: "{" })
    assert.match((await expectFailure(inspect(malformedProject))).message, /Could not parse/)

    const root = await fixture()
    await mkdir(join(root, "node_modules/broken"), { recursive: true })
    await writeFile(join(root, "node_modules/broken/package.json"), "{")
    const error = await expectFailure(
      Effect.gen(function* () {
        const project = yield* Project.Project
        return yield* project.readInstalledManifest(root, "broken")
      }).pipe(Effect.provide(service(root))),
    )
    assert.match(error.message, /Could not parse/)
  })

  it("rejects missing project and installed files", async () => {
    const outside = await mkdtemp(join(tmpdir(), "better-native-outside-"))
    roots.push(outside)
    assert.match((await expectFailure(inspect(outside))).message, /No Expo project/)

    const root = await fixture()
    const error = await expectFailure(
      Effect.gen(function* () {
        const project = yield* Project.Project
        return yield* project.readInstalledManifest(root, "missing")
      }).pipe(Effect.provide(service(root))),
    )
    assert.match(error.message, /Could not read/)
  })

  it("rejects missing or malformed local Expo installations", async () => {
    const missing = await fixture({ expoManifest: null })
    assert.match((await expectFailure(inspect(missing))).message, /project-local expo installation/)

    const noVersion = await fixture({ expoManifest: JSON.stringify({}) })
    assert.match((await expectFailure(inspect(noVersion))).message, /has no version/)

    const noCli = await fixture({ cli: false })
    assert.match((await expectFailure(inspect(noCli))).message, /entrypoint is missing/)
  })
})
