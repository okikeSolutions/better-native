import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Application from "../src/Application.ts"
import * as CommandRunner from "../src/CommandRunner.ts"
import * as Environment from "../src/Environment.ts"
import { capabilities, CliFailure, type CapabilityName } from "../src/Model.ts"
import * as Project from "../src/Project.ts"

/* oxlint-disable effecttsgo/strict-effect-provide -- test runtime boundary */

const baseManifest = {
  dependencies: {
    expo: "57.0.9",
    "expo-clipboard": "57.0.1",
    "@better-native/clipboard": "0.0.1-alpha.1",
    effect: "4.0.0-rc.112",
  },
}

const state = (overrides: Partial<Project.ProjectState> = {}): Project.ProjectState => ({
  root: "/app",
  manifest: baseManifest,
  expoVersion: "57.0.9",
  expoCliPath: "/app/node_modules/expo/bin/cli",
  lockfileManagers: ["bun"],
  ...overrides,
})

const installedVersions: Readonly<Record<string, string>> = {
  "expo-clipboard": "57.0.1",
  "@better-native/clipboard": "0.0.1-alpha.1",
  effect: "4.0.0-rc.112",
}

const makeServices = (options?: {
  readonly states?: ReadonlyArray<Project.ProjectState>
  readonly versions?: Readonly<Record<string, string | undefined>>
  readonly exit?: CliFailure
}) => {
  const states = [...(options?.states ?? [state()])]
  const requests: Array<CommandRunner.RunRequest> = []
  const project = Project.Project.of({
    inspect: Effect.sync(() => states.shift() ?? state()),
    installedManifestPath: (root, packageName) =>
      `${root}/node_modules/${packageName}/package.json`,
    readInstalledManifest: (_root, packageName) => {
      const version = (options?.versions ?? installedVersions)[packageName]
      return Effect.succeed(version === undefined ? {} : { version })
    },
  })
  const runner = CommandRunner.CommandRunner.of({
    inherited: (request) =>
      Effect.sync(() => requests.push(request)).pipe(
        Effect.andThen(options?.exit === undefined ? Effect.void : Effect.fail(options.exit)),
      ),
  })
  const infrastructure = Layer.mergeAll(
    Layer.succeed(Project.Project, project),
    Layer.succeed(CommandRunner.CommandRunner, runner),
    Environment.layer({ cwd: "/app", nodeExecutable: "/node" }),
  )
  return { infrastructure, requests }
}

const runInstall = (
  options: Parameters<typeof makeServices>[0],
  request: Partial<Application.InstallRequest> = {},
) => {
  const services = makeServices(options)
  const layer = Application.installerLayer.pipe(Layer.provide(services.infrastructure))
  return {
    requests: services.requests,
    effect: Effect.gen(function* () {
      const installer = yield* Application.Installer
      yield* installer.install({
        capabilities: ["clipboard"],
        npm: false,
        pnpm: false,
        yarn: false,
        bun: false,
        dryRun: false,
        ...request,
      })
    }).pipe(Effect.provide(layer)),
  }
}

const failure = async (effect: Effect.Effect<void, CliFailure>) => {
  const result = await Effect.runPromiseExit(effect)
  assert.strictEqual(result._tag, "Failure")
  if (result._tag !== "Failure") throw new Error("expected failure")
  const current = result.cause.reasons[0]
  assert.strictEqual(current?._tag, "Fail")
  if (current?._tag !== "Fail") throw new Error("expected typed failure")
  return current.error
}

describe("CLI application services", () => {
  it("creates a dry-run package plan without invoking Expo", async () => {
    const run = runInstall(undefined, { dryRun: true, capabilities: ["clipboard", "clipboard"] })
    await Effect.runPromise(run.effect)
    assert.deepEqual(run.requests, [])
  })

  it("installs and validates selected capability packages", async () => {
    const run = runInstall({ states: [state(), state()] }, { npm: true })
    await Effect.runPromise(run.effect)
    assert.deepEqual(run.requests, [
      {
        executable: "/node",
        arguments: [
          "/app/node_modules/expo/bin/cli",
          "install",
          "expo-clipboard",
          "@better-native/clipboard@0.0.1-alpha.1",
          "effect@4.0.0-rc.112",
          "--npm",
        ],
        cwd: "/app",
      },
    ])
  })

  it("defaults empty capability plans and missing lockfiles", async () => {
    const run = runInstall(
      { states: [state({ lockfileManagers: [] })] },
      { capabilities: [], dryRun: true },
    )
    await Effect.runPromise(run.effect)
    assert.deepEqual(run.requests, [])
  })

  it("rejects unsupported SDKs and ambiguous package managers", async () => {
    const unsupported = await failure(
      runInstall({ states: [state({ expoVersion: "invalid" })] }).effect,
    )
    assert.strictEqual(unsupported.responsibility, "compatibility")

    const explicit = await failure(runInstall(undefined, { npm: true, bun: true }).effect)
    assert.strictEqual(explicit.responsibility, "package-manager")

    const detected = await failure(
      runInstall({ states: [state({ lockfileManagers: ["npm", "pnpm"] })] }).effect,
    )
    assert.match(detected.message, /Multiple package-manager lockfiles/)
  })

  it.each([
    [
      "direct dependency",
      { states: [state(), state({ manifest: { dependencies: { expo: "57.0.9" } } })] },
      /not a direct dependency/,
    ],
    [
      "provider SDK",
      { versions: { ...installedVersions, "expo-clipboard": "56.0.0" } },
      /incompatible/,
    ],
    [
      "wrapper version",
      { versions: { ...installedVersions, "@better-native/clipboard": "0.0.0" } },
      /expected 0.0.1-alpha.1/,
    ],
    ["Effect version", { versions: { ...installedVersions, effect: "3.0.0" } }, /expected 4.0.0/],
    [
      "missing provider version",
      { versions: { ...installedVersions, "expo-clipboard": undefined } },
      /unknown.*incompatible/,
    ],
    [
      "missing wrapper version",
      { versions: { ...installedVersions, "@better-native/clipboard": undefined } },
      /unknown.*expected/,
    ],
    [
      "missing Effect version",
      { versions: { ...installedVersions, effect: undefined } },
      /unknown.*expected/,
    ],
  ] as const)("rejects an invalid %s after installation", async (_, options, message) => {
    const error = await failure(runInstall(options).effect)
    assert.match(error.message, message)
  })

  it("propagates Expo command failures", async () => {
    const expected = new CliFailure({ responsibility: "expo", message: "failed" })
    const error = await failure(runInstall({ exit: expected }).effect)
    assert.strictEqual(error, expected)
  })

  it("diagnoses projects with no installed Better Native capabilities", async () => {
    const services = makeServices({
      states: [state({ manifest: { dependencies: { expo: "57.0.9" } } })],
    })
    const layer = Application.doctorLayer.pipe(Layer.provide(services.infrastructure))
    await Effect.runPromise(
      Effect.gen(function* () {
        const doctor = yield* Application.Doctor
        yield* doctor.run
      }).pipe(Effect.provide(layer)),
    )
  })

  it("validates every directly installed capability", async () => {
    const clipboard = capabilities.clipboard
    const services = makeServices()
    const layer = Application.doctorLayer.pipe(Layer.provide(services.infrastructure))
    await Effect.runPromise(
      Effect.gen(function* () {
        const doctor = yield* Application.Doctor
        yield* doctor.run
      }).pipe(Effect.provide(layer)),
    )
    assert.strictEqual(clipboard.wrapper, "@better-native/clipboard")
  })

  it("rejects ambiguous package managers during diagnosis", async () => {
    const services = makeServices({
      states: [state({ lockfileManagers: ["npm", "yarn"] })],
    })
    const layer = Application.doctorLayer.pipe(Layer.provide(services.infrastructure))
    const error = await failure(
      Effect.gen(function* () {
        const doctor = yield* Application.Doctor
        yield* doctor.run
      }).pipe(Effect.provide(layer)),
    )
    assert.strictEqual(error.responsibility, "package-manager")
  })

  it("keeps capability names typed in install requests", () => {
    const name: CapabilityName = "clipboard"
    assert.strictEqual(name, "clipboard")
  })
})
