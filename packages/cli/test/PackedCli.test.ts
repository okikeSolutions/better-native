import { execFileSync } from "node:child_process"
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { releaseVersion } from "../src/Model.ts"

interface PackResult {
  readonly filename: string
  readonly files: ReadonlyArray<{ readonly path: string }>
}

interface Fixture {
  readonly root: string
  readonly binary: string
  readonly manifestPath: string
  readonly appConfigPath: string
}

const repositoryRoot = resolve(import.meta.dirname, "../../..")
const packageRoot = join(repositoryRoot, "packages/cli")

const run = (command: string, args: ReadonlyArray<string>, cwd: string): string =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })

const fakeExpoCli = `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const root = process.cwd()
const manifestPath = join(root, "package.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
manifest.dependencies ??= {}
const specs = process.argv.slice(2).filter((value) => !value.startsWith("--"))
if (specs.shift() !== "install") process.exit(2)
for (const spec of specs) {
  const separator = spec.lastIndexOf("@")
  const scoped = spec.startsWith("@")
  const packageName = separator > (scoped ? 0 : -1) ? spec.slice(0, separator) : spec
  const requested = separator > (scoped ? 0 : -1) ? spec.slice(separator + 1) : undefined
  const version = requested || (packageName.startsWith("expo-") ? "57.0.1" : "0.0.0")
  manifest.dependencies[packageName] = requested ? version : "~" + version
  const packageManifest = join(root, "node_modules", ...packageName.split("/"), "package.json")
  mkdirSync(dirname(packageManifest), { recursive: true })
  writeFileSync(packageManifest, JSON.stringify({ name: packageName, version }))
  if (packageName === "expo-secure-store") {
    const appConfigPath = join(root, "app.json")
    const appConfig = JSON.parse(readFileSync(appConfigPath, "utf8"))
    appConfig.expo.plugins ??= []
    if (!appConfig.expo.plugins.includes("expo-secure-store")) appConfig.expo.plugins.push("expo-secure-store")
    writeFileSync(appConfigPath, JSON.stringify(appConfig, null, 2))
  }
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
`

const temporaryRoot = mkdtempSync(join(tmpdir(), "better-native-cli-"))
let artifactPath = ""
let binary = ""

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }))

beforeAll(() => {
  const packRoot = join(temporaryRoot, "pack")
  mkdirSync(packRoot, { recursive: true })
  run("bun", ["run", "build"], packageRoot)
  const packed = JSON.parse(
    run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packRoot], packageRoot),
  ) as ReadonlyArray<PackResult>
  assert.lengthOf(packed, 1)
  const artifact = packed[0]
  assert.isDefined(artifact)
  artifactPath = join(packRoot, artifact.filename)
  assert.deepStrictEqual(artifact.files.map((file) => file.path).sort(), [
    "LICENSE",
    "README.md",
    "dist/bin.js",
    "package.json",
  ])
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    bin: Record<string, string>
  }
  assert.deepStrictEqual(manifest.bin, { "better-native": "dist/bin.js" })

  const runnerRoot = join(temporaryRoot, "runner")
  mkdirSync(runnerRoot, { recursive: true })
  writeFileSync(
    join(runnerRoot, "package.json"),
    JSON.stringify({ name: "better-native-cli-runner", private: true }),
  )
  run(
    "npm",
    ["install", "--save-dev", "--ignore-scripts", "--no-audit", "--no-fund", artifactPath],
    runnerRoot,
  )
  binary = join(runnerRoot, "node_modules/better-native/dist/bin.js")
  assert.isTrue(existsSync(join(runnerRoot, "node_modules/.bin/better-native")))
  assert.match(readFileSync(binary, "utf8"), /^#!\/usr\/bin\/env node/)
}, 60_000)

const makeFixture = (name: string): Fixture => {
  const root = join(temporaryRoot, name)
  mkdirSync(root, { recursive: true })
  const manifestPath = join(root, "package.json")
  const appConfigPath = join(root, "app.json")
  writeFileSync(
    manifestPath,
    JSON.stringify({ name: `${name}-fixture`, version: "1.0.0", private: true }),
  )
  writeFileSync(
    appConfigPath,
    JSON.stringify({ expo: { name: `${name}-fixture`, slug: `${name}-fixture` } }, null, 2),
  )
  writeFileSync(join(root, "package-lock.json"), "{}")
  const expoRoot = join(root, "node_modules/expo")
  mkdirSync(join(expoRoot, "bin"), { recursive: true })
  writeFileSync(join(expoRoot, "package.json"), JSON.stringify({ name: "expo", version: "57.0.9" }))
  writeFileSync(join(expoRoot, "bin/cli"), fakeExpoCli)
  chmodSync(join(expoRoot, "bin/cli"), 0o755)
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dependencies?: Record<string, string>
  }
  manifest.dependencies = { ...manifest.dependencies, expo: "57.0.9" }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  return { root, binary, manifestPath, appConfigPath }
}

const installationShapes = [
  {
    capability: "keep-awake",
    reason: "simplest provider case",
    packages: `expo-keep-awake @better-native/keep-awake@${releaseVersion} effect@4.0.0-beta.102`,
  },
  {
    capability: "network",
    reason: "confirms the exact three-package dependency result",
    packages: `expo-network @better-native/network@${releaseVersion} effect@4.0.0-beta.102`,
  },
  {
    capability: "secure-store",
    reason: "exercises config-plugin and rebuild behavior",
    packages: `expo-secure-store @better-native/secure-store@${releaseVersion} effect@4.0.0-beta.102`,
  },
  {
    capability: "battery",
    reason: "confirms the ordinary event/stream case",
    packages: `expo-battery @better-native/battery@${releaseVersion} effect@4.0.0-beta.102`,
  },
] as const

describe("packed better-native CLI installation shapes", () => {
  for (const shape of installationShapes) {
    it(`${shape.capability}: ${shape.reason}`, () => {
      const fixture = makeFixture(shape.capability)
      const packageBefore = readFileSync(fixture.manifestPath, "utf8")
      const appConfigBefore = readFileSync(fixture.appConfigPath, "utf8")
      const plan = run(
        process.execPath,
        [fixture.binary, "install", shape.capability, "--dry-run"],
        fixture.root,
      )
      assert.include(plan, shape.packages)
      assert.strictEqual(readFileSync(fixture.manifestPath, "utf8"), packageBefore)
      assert.strictEqual(readFileSync(fixture.appConfigPath, "utf8"), appConfigBefore)

      const installed = run(
        process.execPath,
        [fixture.binary, "install", shape.capability],
        fixture.root,
      )
      assert.include(installed, `@better-native/${shape.capability} ${releaseVersion} resolves`)
      const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8")) as {
        dependencies: Record<string, string>
      }
      assert.property(manifest.dependencies, `expo-${shape.capability}`)
      assert.property(manifest.dependencies, `@better-native/${shape.capability}`)
      assert.strictEqual(manifest.dependencies.effect, "4.0.0-beta.102")
      assert.notProperty(manifest.dependencies, "better-native")
      assert.notProperty(manifest.dependencies, "expo-modules-core")

      const appConfigAfterInstall = readFileSync(fixture.appConfigPath, "utf8")
      if (shape.capability === "secure-store") {
        assert.notStrictEqual(appConfigAfterInstall, appConfigBefore)
        assert.include(appConfigAfterInstall, '"expo-secure-store"')
        assert.include(installed, "require a rebuilt native binary")
      } else {
        assert.strictEqual(appConfigAfterInstall, appConfigBefore)
      }

      const packageAfterInstall = readFileSync(fixture.manifestPath, "utf8")
      const diagnosis = run(process.execPath, [fixture.binary, "doctor"], fixture.root)
      assert.include(diagnosis, `@better-native/${shape.capability} ${releaseVersion}`)
      assert.strictEqual(readFileSync(fixture.manifestPath, "utf8"), packageAfterInstall)
      assert.strictEqual(readFileSync(fixture.appConfigPath, "utf8"), appConfigAfterInstall)
    }, 60_000)
  }
})

describe("packed better-native CLI architecture", () => {
  it("exposes only install and doctor", () => {
    const fixture = makeFixture("command-surface")
    const help = run(process.execPath, [fixture.binary, "--help"], fixture.root)
    assert.include(help, "install")
    assert.include(help, "doctor")
    assert.notInclude(help, "wizard")
    assert.notInclude(help, "completions")
    assert.notInclude(help, "remove")
    assert.notInclude(help, "upgrade")
  })

  it("contains one managed runtime and no dependency on capability workspaces", () => {
    const source = readFileSync(join(packageRoot, "src/bin.ts"), "utf8")
    assert.lengthOf(source.match(/ManagedRuntime\.make\(/g) ?? [], 1)
    assert.lengthOf(source.match(/NodeRuntime\.runMain\(/g) ?? [], 1)
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Readonly<Record<string, string>>
      devDependencies: Readonly<Record<string, string>>
    }
    assert.isUndefined(manifest.dependencies)
    assert.deepStrictEqual(Object.keys(manifest.devDependencies).sort(), [
      "@effect/platform-node",
      "effect",
    ])
  })

  it("can be pinned only when explicitly installed as a development dependency", () => {
    const root = join(temporaryRoot, "explicit-cli-pin")
    mkdirSync(root, { recursive: true })
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "explicit-cli-pin", private: true }),
    )
    run(
      "npm",
      ["install", "--save-dev", "--ignore-scripts", "--no-audit", "--no-fund", artifactPath],
      root,
    )
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    assert.notProperty(manifest.dependencies ?? {}, "better-native")
    assert.property(manifest.devDependencies ?? {}, "better-native")
  }, 60_000)
})
