import * as Console from "effect/Console"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as CommandRunner from "./CommandRunner.ts"
import * as Environment from "./Environment.ts"
import {
  capabilities,
  capabilityNames,
  CliFailure,
  type Capability,
  type CapabilityName,
  type PackageManagerName,
} from "./Model.ts"
import * as Project from "./Project.ts"

export interface PackageManagerFlags {
  readonly npm: boolean
  readonly pnpm: boolean
  readonly yarn: boolean
  readonly bun: boolean
}

export type InstallRequest = PackageManagerFlags & {
  readonly capabilities: ReadonlyArray<CapabilityName>
  readonly dryRun: boolean
}

const dependenciesOf = (manifest: Project.PackageManifest): Readonly<Record<string, string>> => ({
  ...manifest.devDependencies,
  ...manifest.dependencies,
})

const sdkMajor = (version: string): number | undefined => {
  const value = Number.parseInt(version.split(".")[0] ?? "", 10)
  return Number.isNaN(value) ? undefined : value
}

const selectPackageManager = (
  flags: PackageManagerFlags,
  detected: ReadonlyArray<PackageManagerName>,
): Effect.Effect<PackageManagerName, CliFailure> => {
  const selected = (["npm", "pnpm", "yarn", "bun"] as const).filter((name) => flags[name])
  if (selected.length > 1) {
    return Effect.fail(
      new CliFailure({
        responsibility: "package-manager",
        message: "Choose only one of --npm, --pnpm, --yarn, or --bun.",
      }),
    )
  }
  if (selected[0] !== undefined) return Effect.succeed(selected[0])
  if (detected.length > 1) {
    return Effect.fail(
      new CliFailure({
        responsibility: "package-manager",
        message: `Multiple package-manager lockfiles were found (${detected.join(", ")}). Select one explicitly.`,
      }),
    )
  }
  return Effect.succeed(detected[0] ?? "npm")
}

const validateSdk = (version: string): Effect.Effect<void, CliFailure> =>
  sdkMajor(version) === 57
    ? Effect.void
    : Effect.fail(
        new CliFailure({
          responsibility: "compatibility",
          message: `Expo ${version} is unsupported by this CLI. The initial compatibility registry supports Expo SDK 57.`,
        }),
      )

const validateCapability = Effect.fn("Application.validateCapability")(function* (
  service: Project.Service,
  project: Project.ProjectState,
  capability: Capability,
) {
  const direct = dependenciesOf(project.manifest)
  for (const packageName of [capability.provider, capability.wrapper, "effect"]) {
    if (direct[packageName] === undefined) {
      return yield* new CliFailure({
        responsibility: "validation",
        message: `${packageName} is not a direct dependency of ${project.root}.`,
      })
    }
  }

  const provider = yield* service.readInstalledManifest(project.root, capability.provider)
  const wrapper = yield* service.readInstalledManifest(project.root, capability.wrapper)
  const effect = yield* service.readInstalledManifest(project.root, "effect")
  if (sdkMajor(provider.version ?? "") !== 57) {
    return yield* new CliFailure({
      responsibility: "validation",
      message: `${capability.provider} ${provider.version ?? "unknown"} is incompatible with Expo SDK 57.`,
    })
  }
  if (wrapper.version !== capability.wrapperVersion) {
    return yield* new CliFailure({
      responsibility: "validation",
      message: `${capability.wrapper} resolved to ${wrapper.version ?? "unknown"}; expected ${capability.wrapperVersion}.`,
    })
  }
  if (effect.version !== capability.effectVersion) {
    return yield* new CliFailure({
      responsibility: "validation",
      message: `effect resolved to ${effect.version ?? "unknown"}; expected ${capability.effectVersion}.`,
    })
  }
})

export interface InstallerService {
  readonly install: (request: InstallRequest) => Effect.Effect<void, CliFailure>
}

export class Installer extends Context.Service<Installer, InstallerService>()(
  "better-native/Installer",
) {}

export const installerLayer: Layer.Layer<
  Installer,
  never,
  Project.Project | CommandRunner.CommandRunner | Environment.Environment
> = Layer.effect(
  Installer,
  Effect.gen(function* () {
    const projects = yield* Project.Project
    const runner = yield* CommandRunner.CommandRunner
    const environment = yield* Environment.Environment
    const install = Effect.fn("Installer.install")(function* (request: InstallRequest) {
      const project = yield* projects.inspect
      yield* validateSdk(project.expoVersion)
      const manager = yield* selectPackageManager(request, project.lockfileManagers)
      const selected = [...new Set(request.capabilities)].map((name) => capabilities[name])
      const packagePlan = [
        ...selected.map((capability) => capability.provider),
        ...selected.map((capability) => `${capability.wrapper}@${capability.wrapperVersion}`),
        `effect@${selected[0]?.effectVersion ?? "4.0.0-beta.102"}`,
      ]

      yield* Console.log(`✓ Expo SDK 57 detected (${project.expoVersion})`)
      yield* Console.log(`✓ Package manager: ${manager}`)
      yield* Console.log(`Package plan: ${packagePlan.join(" ")}`)
      if (request.dryRun) {
        yield* Console.log("Dry run complete; no files were changed.")
        return
      }

      yield* runner.inherited({
        executable: environment.nodeExecutable,
        arguments: [project.expoCliPath, "install", ...packagePlan, `--${manager}`],
        cwd: project.root,
      })

      const installed = yield* projects.inspect
      for (const capability of selected) {
        yield* validateCapability(projects, installed, capability)
        yield* Console.log(`✓ ${capability.wrapper} ${capability.wrapperVersion} resolves`)
        yield* Console.log(
          `  import { ${capability.importName} } from ${JSON.stringify(capability.wrapper)}`,
        )
      }
      yield* Console.log(
        "ℹ Native providers changed or added by this plan require a rebuilt native binary.",
      )
    })
    return Installer.of({ install })
  }),
)

export interface DoctorService {
  readonly run: Effect.Effect<void, CliFailure>
}

export class Doctor extends Context.Service<Doctor, DoctorService>()("better-native/Doctor") {}

export const doctorLayer: Layer.Layer<Doctor, never, Project.Project> = Layer.effect(
  Doctor,
  Effect.gen(function* () {
    const projects = yield* Project.Project
    const run = Effect.gen(function* () {
      const project = yield* projects.inspect
      yield* validateSdk(project.expoVersion)
      if (project.lockfileManagers.length > 1) {
        return yield* new CliFailure({
          responsibility: "package-manager",
          message: `Multiple package-manager lockfiles were found (${project.lockfileManagers.join(", ")}).`,
        })
      }
      yield* Console.log(`✓ Expo SDK 57 detected (${project.expoVersion})`)
      yield* Console.log(`✓ Project root: ${project.root}`)
      yield* Console.log(`✓ Package manager: ${project.lockfileManagers[0] ?? "npm (default)"}`)

      const direct = dependenciesOf(project.manifest)
      const installed = capabilityNames.filter(
        (name) => direct[capabilities[name].wrapper] !== undefined,
      )
      if (installed.length === 0) {
        yield* Console.log("ℹ No Better Native capability packages are direct dependencies.")
        return
      }
      for (const name of installed) {
        const capability = capabilities[name]
        yield* validateCapability(projects, project, capability)
        yield* Console.log(
          `✓ ${capability.wrapper} ${capability.wrapperVersion}: ${capability.status} ownership validated`,
        )
      }
    })
    return Doctor.of({ run })
  }),
)
