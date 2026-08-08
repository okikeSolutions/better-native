import { strict as assert } from "node:assert"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dirname, "../../..")
const temporaryRoot = mkdtempSync(join(tmpdir(), "better-native-registry-"))
const releaseVersion = (
  JSON.parse(readFileSync(join(repositoryRoot, "packages/cli/package.json"), "utf8")) as {
    version: string
  }
).version

const capabilityMatrix = [
  ["keep-awake", "expo-keep-awake"],
  ["network", "expo-network"],
  ["secure-store", "expo-secure-store"],
  ["battery", "expo-battery"],
] as const

const run = (
  command: string,
  args: ReadonlyArray<string>,
  cwd = repositoryRoot,
  environment: NodeJS.ProcessEnv = process.env,
): string =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...environment, CI: "1", EXPO_NO_TELEMETRY: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })

const reservePort = (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      assert(address && typeof address !== "string")
      server.close((error) => (error ? reject(error) : resolvePort(address.port)))
    })
  })

const waitForRegistry = async (registry: string, process: ChildProcess): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`Verdaccio exited with ${process.exitCode}`)
    try {
      const response = await fetch(registry)
      if (response.ok) return
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error("Timed out waiting for the local npm registry")
}

const writeSeedPackage = (name: string, version: string): string => {
  const root = join(temporaryRoot, "seed", ...name.split("/"))
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name, version, license: "MIT", main: "index.js" }),
  )
  writeFileSync(join(root, "index.js"), "export {}\n")
  return root
}

const fakeExpoCli = `#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const args = process.argv.slice(2)
if (args.shift() !== "install") process.exit(2)
const specs = args.filter((value) => !value.startsWith("--"))
execFileSync("npm", ["install", "--save", "--save-exact", "--legacy-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund", ...specs], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
})
if (specs.some((spec) => spec === "expo-secure-store")) {
  const appConfigPath = join(root, "app.json")
  const appConfig = JSON.parse(readFileSync(appConfigPath, "utf8"))
  appConfig.expo.plugins ??= []
  appConfig.expo.plugins.push("expo-secure-store")
  writeFileSync(appConfigPath, JSON.stringify(appConfig, null, 2))
}
`

let registryProcess: ChildProcess | undefined

try {
  const port = await reservePort()
  const registry = `http://127.0.0.1:${port}`
  const configPath = join(temporaryRoot, "verdaccio.yaml")
  writeFileSync(
    configPath,
    JSON.stringify({
      storage: join(temporaryRoot, "storage"),
      auth: { htpasswd: { file: join(temporaryRoot, "htpasswd"), max_users: -1 } },
      uplinks: {},
      packages: {
        "@*/*": { access: "$all", publish: "$all", unpublish: "$all" },
        "**": { access: "$all", publish: "$all", unpublish: "$all" },
      },
      log: { type: "stdout", format: "pretty", level: "warn" },
    }),
  )
  registryProcess = spawn(
    "npm",
    [
      "exec",
      "--yes",
      "--package=verdaccio@6.9.2",
      "--",
      "verdaccio",
      "--config",
      configPath,
      "--listen",
      `127.0.0.1:${port}`,
    ],
    { cwd: temporaryRoot, stdio: ["ignore", "inherit", "inherit"] },
  )
  await waitForRegistry(registry, registryProcess)
  const npmConfigPath = join(temporaryRoot, "npmrc")
  writeFileSync(
    npmConfigPath,
    `registry=${registry}\n//127.0.0.1:${port}/:_authToken=local-registry-test\n`,
  )
  const registryEnvironment = {
    ...process.env,
    npm_config_registry: registry,
    npm_config_userconfig: npmConfigPath,
  }

  run(
    "bun",
    [
      "run",
      "build",
      "--filter=better-native",
      ...capabilityMatrix.map(([name]) => `--filter=@better-native/${name}`),
    ],
    repositoryRoot,
    registryEnvironment,
  )

  const publish = (target: string, tag: "alpha" | "latest"): void => {
    run(
      "npm",
      [
        "publish",
        target,
        "--registry",
        registry,
        "--access",
        "public",
        "--ignore-scripts",
        "--tag",
        tag,
      ],
      repositoryRoot,
      registryEnvironment,
    )
  }

  publish(writeSeedPackage("effect", "4.0.0-beta.102"), "alpha")
  for (const [, provider] of capabilityMatrix)
    publish(writeSeedPackage(provider, "57.0.1"), "latest")
  for (const [name] of capabilityMatrix) publish(join(repositoryRoot, "packages", name), "alpha")
  publish(join(repositoryRoot, "packages/cli"), "alpha")

  for (const [capability, provider] of capabilityMatrix) {
    const root = join(temporaryRoot, "fixtures", capability)
    const expoRoot = join(root, "fake-expo")
    mkdirSync(join(expoRoot, "bin"), { recursive: true })
    writeFileSync(
      join(expoRoot, "package.json"),
      JSON.stringify({ name: "expo", version: "57.0.9", bin: { expo: "bin/cli" } }),
    )
    writeFileSync(join(expoRoot, "bin/cli"), fakeExpoCli)
    chmodSync(join(expoRoot, "bin/cli"), 0o755)
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: `registry-${capability}-fixture`,
        version: "1.0.0",
        private: true,
        dependencies: { expo: "file:./fake-expo" },
      }),
    )
    writeFileSync(
      join(root, "app.json"),
      JSON.stringify({ expo: { name: capability, slug: capability } }, null, 2),
    )
    run(
      "npm",
      ["install", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund"],
      root,
      registryEnvironment,
    )

    const output = run(
      "npm",
      [
        "exec",
        "--yes",
        `--package=better-native@${releaseVersion}`,
        "--",
        "better-native",
        "install",
        capability,
      ],
      root,
      registryEnvironment,
    )
    assert.ok(output.includes(`@better-native/${capability} ${releaseVersion} resolves`))

    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const additions = Object.keys(manifest.dependencies)
      .filter((name) => name !== "expo")
      .sort()
    assert.deepEqual(additions, [`@better-native/${capability}`, "effect", provider].sort())
    assert.equal(manifest.dependencies.effect, "4.0.0-beta.102")
    assert.equal(manifest.dependencies[`@better-native/${capability}`], releaseVersion)
    assert.equal(manifest.dependencies[provider], "57.0.1")
    assert.equal(manifest.dependencies["better-native"], undefined)
    assert.equal(manifest.devDependencies?.["better-native"], undefined)
    assert.equal(
      readFileSync(join(root, "node_modules", provider, "package.json"), "utf8").length > 0,
      true,
    )
    assert.equal(
      readFileSync(join(root, "node_modules", "@better-native", capability, "package.json"), "utf8")
        .length > 0,
      true,
    )

    run(
      "npm",
      [
        "exec",
        "--yes",
        `--package=better-native@${releaseVersion}`,
        "--",
        "better-native",
        "doctor",
      ],
      root,
      registryEnvironment,
    )
  }

  process.stdout.write("Local-registry installation matrix passed.\n")
} finally {
  registryProcess?.kill("SIGTERM")
  rmSync(temporaryRoot, { recursive: true, force: true })
}
