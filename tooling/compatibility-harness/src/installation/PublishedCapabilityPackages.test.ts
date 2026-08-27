import { execFileSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest"
import { satisfies } from "semver"

interface PackedFile {
  readonly path: string
}

interface PackResult {
  readonly filename: string
  readonly files: ReadonlyArray<PackedFile>
}

const decodePackResults = (output: string): ReadonlyArray<PackResult> => {
  const parsed = JSON.parse(output) as ReadonlyArray<PackResult> | Record<string, PackResult>
  return Array.isArray(parsed) ? parsed : Object.values(parsed)
}

interface PublishedManifest {
  readonly name: string
  readonly version: string
  readonly private: boolean
  readonly license: string
  readonly sideEffects: boolean | ReadonlyArray<string>
  readonly main: string
  readonly types: string
  readonly files: ReadonlyArray<string>
  readonly scripts: Record<string, string>
  readonly dependencies?: Record<string, string>
  readonly devDependencies: Record<string, string>
  readonly peerDependencies: Record<string, string>
  readonly publishConfig: { readonly access: string }
  readonly exports: Record<string, unknown>
}

interface AutolinkingModule {
  readonly packageName: string
  readonly packageVersion: string
  readonly pods?: ReadonlyArray<unknown>
  readonly projects?: ReadonlyArray<unknown>
}

interface AutolinkingResult {
  readonly modules: ReadonlyArray<AutolinkingModule>
}

interface PackageVersionManifest {
  readonly version: string
}

const repositoryRoot = resolve(import.meta.dirname, "../../../../")

interface PublishedCapability {
  readonly directory: string
  readonly name: string
  readonly provider: string
  readonly sideEffects: boolean | ReadonlyArray<string>
  readonly exports: ReadonlyArray<string>
  readonly requiredBuildFiles: ReadonlyArray<string>
  readonly pluginEntrypoints: ReadonlyArray<string>
  readonly typedEntrypoints: ReadonlyArray<string>
  readonly runtimeEntrypoints: ReadonlyArray<string>
  readonly taskManagerWrapper: boolean
  readonly taskManagerProvider: boolean
  readonly optionalTaskManager: boolean
}

const standard = (input: {
  readonly directory: string
  readonly name: string
  readonly provider: string
  readonly plugin?: boolean
}): PublishedCapability => ({
  ...input,
  sideEffects: false,
  exports: [".", "./expo", ...(input.plugin ? ["./app.plugin"] : []), "./package.json"],
  requiredBuildFiles: input.plugin ? ["build/Plugin.js", "build/Plugin.d.ts"] : [],
  pluginEntrypoints: input.plugin ? ["./app.plugin"] : [],
  typedEntrypoints: [],
  runtimeEntrypoints: [],
  taskManagerWrapper: false,
  taskManagerProvider: false,
  optionalTaskManager: false,
})

const packages: ReadonlyArray<PublishedCapability> = [
  standard({ directory: "network", name: "@better-native/network", provider: "expo-network" }),
  standard({ directory: "battery", name: "@better-native/battery", provider: "expo-battery" }),
  {
    ...standard({
      directory: "keep-awake",
      name: "@better-native/keep-awake",
      provider: "expo-keep-awake",
    }),
  },
  standard({
    directory: "secure-store",
    name: "@better-native/secure-store",
    provider: "expo-secure-store",
  }),
  standard({
    directory: "task-manager",
    name: "@better-native/task-manager",
    provider: "expo-task-manager",
    plugin: true,
  }),
  {
    ...standard({
      directory: "background-task",
      name: "@better-native/background-task",
      provider: "expo-background-task",
      plugin: true,
    }),
    taskManagerWrapper: true,
    taskManagerProvider: true,
  },
  {
    ...standard({
      directory: "location",
      name: "@better-native/location",
      provider: "expo-location",
      plugin: true,
    }),
    taskManagerWrapper: true,
    optionalTaskManager: true,
  },
  {
    ...standard({
      directory: "notifications",
      name: "@better-native/notifications",
      provider: "expo-notifications",
      plugin: true,
    }),
    exports: [".", "./expo", "./app.plugin", "./background", "./package.json"],
    requiredBuildFiles: [
      "build/Plugin.js",
      "build/Plugin.d.ts",
      "build/Background.js",
      "build/Background.d.ts",
    ],
    typedEntrypoints: ["./background"],
    taskManagerWrapper: true,
    optionalTaskManager: true,
    taskManagerProvider: true,
    sideEffects: [
      "./build/index.js",
      "./build/Module.js",
      "./build/Notifications.js",
      "./build/Expo.js",
    ],
  },
  {
    ...standard({
      directory: "sqlite",
      name: "@better-native/sqlite",
      provider: "expo-sqlite",
    }),
    sideEffects: ["./build/LocalStorageInstall.js"],
    exports: [
      ".",
      "./expo",
      "./client",
      "./sqlite",
      "./kv-store",
      "./localStorage/install",
      "./app.plugin.js",
      "./plugin",
      "./package.json",
    ],
    requiredBuildFiles: [
      "build/SqliteClient.js",
      "build/SqliteClient.d.ts",
      "build/SQLite.js",
      "build/SQLite.d.ts",
      "build/KVStore.js",
      "build/KVStore.d.ts",
      "build/LocalStorageInstall.js",
      "build/Plugin.js",
      "build/Plugin.d.ts",
    ],
    pluginEntrypoints: ["./app.plugin.js", "./plugin"],
    typedEntrypoints: ["./client", "./sqlite", "./kv-store"],
    runtimeEntrypoints: ["./localStorage/install"],
  },
]

const run = (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  env?: Readonly<Record<string, string>>,
): string =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  })

const readManifest = (path: string): PublishedManifest =>
  JSON.parse(readFileSync(path, "utf8")) as PublishedManifest

const rootDependencyPath = (name: string): string =>
  join(repositoryRoot, "node_modules", ...name.split("/"))

const linkRootDependency = (fixtureRoot: string, name: string): void => {
  const target = rootDependencyPath(name)
  const destination = join(fixtureRoot, "node_modules", ...name.split("/"))
  assert.isTrue(existsSync(target), `repository dependency ${name} is missing`)
  mkdirSync(dirname(destination), { recursive: true })
  if (!existsSync(destination)) {
    symlinkSync(target, destination, process.platform === "win32" ? "junction" : "dir")
  }
}

const materializeRootDependency = (fixtureRoot: string, name: string): void => {
  const target = rootDependencyPath(name)
  const destination = join(fixtureRoot, "node_modules", ...name.split("/"))
  assert.isTrue(existsSync(target), `repository dependency ${name} is missing`)
  mkdirSync(dirname(destination), { recursive: true })
  if (!existsSync(destination)) cpSync(target, destination, { recursive: true })
}

const dependencyVersion = (name: string): string =>
  (
    JSON.parse(
      readFileSync(join(rootDependencyPath(name), "package.json"), "utf8"),
    ) as PackageVersionManifest
  ).version

const findJavaScriptFiles = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return findJavaScriptFiles(path)
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [path] : []
  })

const pack = (
  capability: (typeof packages)[number],
  temporaryRoot: string,
): { readonly artifactPath: string; readonly artifact: PackResult } => {
  const packageRoot = join(repositoryRoot, "packages", capability.directory)
  const packRoot = join(temporaryRoot, "pack")
  mkdirSync(packRoot, { recursive: true })
  const results = decodePackResults(
    run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packRoot], packageRoot),
  )
  assert.lengthOf(results, 1)
  const artifact = results[0]
  assert.isDefined(artifact)
  const artifactPath = join(packRoot, artifact.filename)
  assert.isTrue(existsSync(artifactPath))
  return { artifact, artifactPath }
}

describe("published capability packages", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "better-native-publication-"))
  const artifacts = new Map<string, ReturnType<typeof pack>>()

  beforeAll(() => {
    run(
      "bun",
      [
        "x",
        "turbo",
        "run",
        "build",
        ...packages.map((capability) => `--filter=${capability.name}`),
        "--concurrency=2",
      ],
      repositoryRoot,
    )
    for (const capability of packages) {
      artifacts.set(capability.name, pack(capability, join(temporaryRoot, capability.directory)))
    }
  }, 60_000)

  afterAll(() => {
    rmSync(temporaryRoot, { recursive: true, force: true })
  })

  for (const capability of packages) {
    it(`installs the ${capability.name} tarball in Expo and proves peer, Metro, and native resolution`, () => {
      const packageRoot = join(repositoryRoot, "packages", capability.directory)
      const manifest = readManifest(join(packageRoot, "package.json"))
      const packed = artifacts.get(capability.name)
      assert.isDefined(packed)

      assert.strictEqual(manifest.name, capability.name)
      assert.strictEqual(manifest.version, "0.0.1-alpha.1")
      assert.isFalse(manifest.private)
      assert.strictEqual(manifest.license, "MIT")
      assert.deepStrictEqual(manifest.sideEffects, capability.sideEffects)
      assert.strictEqual(manifest.main, "./build/index.js")
      assert.strictEqual(manifest.types, "./build/index.d.ts")
      assert.deepStrictEqual(manifest.files, ["build", "LICENSE", "README.md"])
      assert.strictEqual(manifest.scripts.prepack, "bun run build")
      assert.isUndefined(manifest.dependencies)
      assert.strictEqual(manifest.devDependencies.effect, "4.0.0-rc.112")
      assert.deepStrictEqual(manifest.peerDependencies, {
        ...(capability.taskManagerWrapper
          ? { "@better-native/task-manager": "0.0.1-alpha.1" }
          : {}),
        effect: "4.0.0-rc.112",
        [capability.provider]: ">=57.0.0 <58.0.0",
        ...(capability.taskManagerProvider ? { "expo-task-manager": ">=57.0.0 <58.0.0" } : {}),
      })
      assert.strictEqual(manifest.publishConfig.access, "public")
      assert.deepStrictEqual(Object.keys(manifest.exports).sort(), [...capability.exports].sort())

      const packedFiles = new Set(packed.artifact.files.map((file) => file.path))
      for (const required of [
        "LICENSE",
        "README.md",
        "package.json",
        "build/index.js",
        "build/index.d.ts",
        "build/Expo.js",
        "build/Expo.d.ts",
        ...capability.requiredBuildFiles,
      ]) {
        assert.isTrue(packedFiles.has(required), `${capability.name} is missing ${required}`)
      }
      assert.isTrue(
        [...packedFiles].every(
          (path) =>
            path === "LICENSE" ||
            path === "README.md" ||
            path === "package.json" ||
            path.startsWith("build/"),
        ),
        `${capability.name} contains a file outside its publish allowlist`,
      )

      const fixtureRoot = join(temporaryRoot, capability.directory, "fixture")
      try {
        mkdirSync(fixtureRoot, { recursive: true })
        writeFileSync(
          join(fixtureRoot, "package.json"),
          JSON.stringify({
            name: `packed-${capability.directory}-expo-fixture`,
            version: "1.0.0",
            private: true,
            type: "module",
            main: "./index.js",
          }),
        )

        run(
          "npm",
          [
            "install",
            "--ignore-scripts",
            "--legacy-peer-deps",
            "--no-package-lock",
            "--no-audit",
            "--no-fund",
            packed.artifactPath,
          ],
          fixtureRoot,
        )
        if (capability.taskManagerWrapper) {
          const companion = artifacts.get("@better-native/task-manager")
          assert.isDefined(companion)
          run(
            "npm",
            [
              "install",
              "--ignore-scripts",
              "--legacy-peer-deps",
              "--no-package-lock",
              "--no-audit",
              "--no-fund",
              companion.artifactPath,
            ],
            fixtureRoot,
          )
        }

        // Keep this integration test deterministic and offline: only the capability is
        // installed from its tarball; the Expo SDK and its build tools are the exact
        // versions pinned and validated by this repository.
        const fixtureDependencies = [
          "effect",
          "expo",
          capability.provider,
          "react",
          "react-dom",
          "react-native",
          "react-native-web",
          "expo-modules-core",
          "babel-preset-expo",
          ...(capability.provider === "expo-sqlite" ? ["await-lock"] : []),
          ...(capability.taskManagerProvider ? ["expo-task-manager"] : []),
        ] as const
        for (const dependency of fixtureDependencies) {
          // Metro resolves SQLite's WASM asset relative to the project root. Materialize that
          // provider instead of symlinking it outside the isolated fixture so the packed web gate
          // exercises the same package bytes without violating Metro's asset boundary.
          if (dependency === "expo-sqlite") materializeRootDependency(fixtureRoot, dependency)
          else linkRootDependency(fixtureRoot, dependency)
        }

        const installedRoot = join(fixtureRoot, "node_modules", ...capability.name.split("/"))
        const installedManifest = readManifest(join(installedRoot, "package.json"))
        assert.deepStrictEqual(installedManifest.peerDependencies, {
          ...(capability.taskManagerWrapper
            ? { "@better-native/task-manager": "0.0.1-alpha.1" }
            : {}),
          effect: "4.0.0-rc.112",
          [capability.provider]: ">=57.0.0 <58.0.0",
          ...(capability.taskManagerProvider ? { "expo-task-manager": ">=57.0.0 <58.0.0" } : {}),
        })
        const effectPeer = installedManifest.peerDependencies.effect
        const providerPeer = installedManifest.peerDependencies[capability.provider]
        assert.isDefined(effectPeer)
        assert.isDefined(providerPeer)
        assert.isTrue(satisfies(dependencyVersion("effect"), effectPeer))
        assert.isTrue(satisfies(dependencyVersion(capability.provider), providerPeer))
        assert.isUndefined(installedManifest.dependencies)
        assert.isFalse(existsSync(join(installedRoot, "node_modules")))
        for (const pluginEntrypoint of capability.pluginEntrypoints) {
          run(
            process.execPath,
            [
              "--input-type=module",
              "--eval",
              `const plugin = await import(${JSON.stringify(`${capability.name}${pluginEntrypoint.slice(1)}`)}); if (typeof plugin.default !== "function") throw new Error("missing plugin default export")`,
            ],
            fixtureRoot,
          )
        }
        assert.deepStrictEqual(
          readdirSync(join(installedRoot, "build")).sort(),
          packed.artifact.files
            .map((file) => file.path)
            .filter(
              (path) => path.startsWith("build/") && !path.slice("build/".length).includes("/"),
            )
            .map((path) => path.slice("build/".length))
            .sort(),
        )

        const fixtureManifest = JSON.parse(
          readFileSync(join(fixtureRoot, "package.json"), "utf8"),
        ) as { dependencies?: Record<string, string> }
        fixtureManifest.dependencies = {
          ...fixtureManifest.dependencies,
          ...Object.fromEntries(
            fixtureDependencies.map((dependency) => [dependency, dependencyVersion(dependency)]),
          ),
        }
        writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify(fixtureManifest, null, 2))

        writeFileSync(
          join(fixtureRoot, "index.ts"),
          [
            `import * as Capability from ${JSON.stringify(capability.name)}`,
            `import * as ExpoCompatibility from ${JSON.stringify(`${capability.name}/expo`)}`,
            ...capability.typedEntrypoints.map(
              (entrypoint, index) =>
                `import * as Extra${index} from ${JSON.stringify(`${capability.name}${entrypoint.slice(1)}`)}`,
            ),
            `export const packedImports = [Capability, ExpoCompatibility${capability.typedEntrypoints.map((_, index) => `, Extra${index}`).join("")}] as const`,
            "",
          ].join("\n"),
        )
        run(
          process.execPath,
          [
            join(repositoryRoot, "node_modules/typescript/bin/tsc"),
            "--noEmit",
            "--module",
            "ESNext",
            "--moduleResolution",
            "Bundler",
            "--target",
            "ES2022",
            "--skipLibCheck",
            join(fixtureRoot, "index.ts"),
          ],
          fixtureRoot,
        )

        writeFileSync(
          join(fixtureRoot, "index.js"),
          [
            `import * as Capability from ${JSON.stringify(capability.name)}`,
            `import * as ExpoCompatibility from ${JSON.stringify(`${capability.name}/expo`)}`,
            ...[...capability.typedEntrypoints, ...capability.runtimeEntrypoints].map(
              (entrypoint, index) =>
                `import * as Extra${index} from ${JSON.stringify(`${capability.name}${entrypoint.slice(1)}`)}`,
            ),
            `globalThis.__betterNativePackedFixture = [Capability, ExpoCompatibility${[...capability.typedEntrypoints, ...capability.runtimeEntrypoints].map((_, index) => `, Extra${index}`).join("")}]`,
            "",
          ].join("\n"),
        )
        writeFileSync(
          join(fixtureRoot, "app.json"),
          JSON.stringify({
            expo: {
              name: `packed-${capability.directory}`,
              slug: `packed-${capability.directory}`,
              version: "1.0.0",
              platforms: ["ios", "android", "web"],
            },
          }),
        )
        if (capability.provider === "expo-sqlite") {
          writeFileSync(
            join(fixtureRoot, "metro.config.cjs"),
            [
              'const { getDefaultConfig } = require("expo/metro-config")',
              "const config = getDefaultConfig(__dirname)",
              'if (!config.resolver.assetExts.includes("wasm")) config.resolver.assetExts.push("wasm")',
              "module.exports = config",
              "",
            ].join("\n"),
          )
        }
        const exportRoot = join(fixtureRoot, "dist")
        run(
          process.execPath,
          [
            join(fixtureRoot, "node_modules/expo/bin/cli"),
            "export",
            "--platform",
            "web",
            "--output-dir",
            exportRoot,
            "--clear",
          ],
          fixtureRoot,
          { CI: "1", EXPO_NO_TELEMETRY: "1" },
        )
        assert.isAbove(findJavaScriptFiles(exportRoot).length, 0)

        const autolinkingCli = join(
          repositoryRoot,
          "node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js",
        )
        for (const platform of ["apple", "android"] as const) {
          const result = JSON.parse(
            run(
              process.execPath,
              [
                autolinkingCli,
                "resolve",
                "--platform",
                platform,
                "--project-root",
                fixtureRoot,
                "--json",
              ],
              fixtureRoot,
            ),
          ) as AutolinkingResult
          const expectedProviders = [
            capability.provider,
            ...(capability.taskManagerProvider ? ["expo-task-manager"] : []),
          ]
          for (const provider of expectedProviders) {
            const providers = result.modules.filter((module) => module.packageName === provider)
            assert.lengthOf(providers, 1)
            assert.strictEqual(providers[0]?.packageVersion, dependencyVersion(provider))
            assert.isAbove(
              platform === "apple"
                ? (providers[0]?.pods?.length ?? 0)
                : (providers[0]?.projects?.length ?? 0),
              0,
            )
          }
          assert.isFalse(result.modules.some((module) => module.packageName === capability.name))
        }
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true })
      }
    }, 60_000)
  }
})
