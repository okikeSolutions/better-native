import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Environment from "./Environment.ts"
import { CliFailure, type PackageManagerName } from "./Model.ts"

export interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

export interface ProjectState {
  readonly root: string
  readonly manifest: PackageManifest
  readonly expoVersion: string
  readonly expoCliPath: string
  readonly lockfileManagers: ReadonlyArray<PackageManagerName>
}

export interface Service {
  readonly inspect: Effect.Effect<ProjectState, CliFailure>
  readonly readInstalledManifest: (
    root: string,
    packageName: string,
  ) => Effect.Effect<PackageManifest, CliFailure>
  readonly installedManifestPath: (root: string, packageName: string) => string
}

export class Project extends Context.Service<Project, Service>()("better-native/Project") {}

const parseManifest = (source: string, path: string): Effect.Effect<PackageManifest, CliFailure> =>
  Effect.try({
    try: () => JSON.parse(source) as PackageManifest,
    catch: (cause) =>
      new CliFailure({
        responsibility: "project",
        message: `Could not parse ${path} as JSON.`,
        cause,
      }),
  })

export const layer: Layer.Layer<
  Project,
  never,
  FileSystem.FileSystem | Path.Path | Environment.Environment
> = Layer.effect(
  Project,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const environment = yield* Environment.Environment

    const installedManifestPath = (root: string, packageName: string): string =>
      path.join(root, "node_modules", ...packageName.split("/"), "package.json")

    const readManifest = Effect.fn("Project.readManifest")(function* (manifestPath: string) {
      const source = yield* fs.readFileString(manifestPath).pipe(
        Effect.mapError(
          (cause) =>
            new CliFailure({
              responsibility: "project",
              message: `Could not read ${manifestPath}.`,
              cause,
            }),
        ),
      )
      return yield* parseManifest(source, manifestPath)
    })

    const readInstalledManifest = (root: string, packageName: string) =>
      readManifest(installedManifestPath(root, packageName))

    const exists = (candidate: string) =>
      fs.exists(candidate).pipe(
        Effect.mapError(
          (cause) =>
            new CliFailure({
              responsibility: "project",
              message: `Could not inspect ${candidate}.`,
              cause,
            }),
        ),
      )

    const inspect = Effect.gen(function* () {
      let current = path.resolve(environment.cwd)
      let manifest: PackageManifest | undefined
      while (true) {
        const manifestPath = path.join(current, "package.json")
        if (yield* exists(manifestPath)) {
          const candidate = yield* readManifest(manifestPath)
          const declared = { ...candidate.devDependencies, ...candidate.dependencies }
          if (declared.expo !== undefined) {
            manifest = candidate
            break
          }
        }
        const parent = path.dirname(current)
        if (parent === current) {
          return yield* new CliFailure({
            responsibility: "project",
            message:
              "No Expo project was found. Run this command inside a project with a local expo dependency.",
          })
        }
        current = parent
      }

      const expoManifestPath = installedManifestPath(current, "expo")
      if (!(yield* exists(expoManifestPath))) {
        return yield* new CliFailure({
          responsibility: "project",
          message: `The Expo project at ${current} does not have a project-local expo installation.`,
        })
      }
      const expoManifest = yield* readManifest(expoManifestPath)
      if (expoManifest.version === undefined) {
        return yield* new CliFailure({
          responsibility: "project",
          message: `The installed expo package at ${expoManifestPath} has no version.`,
        })
      }
      const expoCliPath = path.join(current, "node_modules", "expo", "bin", "cli")
      if (!(yield* exists(expoCliPath))) {
        return yield* new CliFailure({
          responsibility: "project",
          message: `The project-local Expo CLI entrypoint is missing at ${expoCliPath}.`,
        })
      }

      const lockfiles = [
        ["bun.lock", "bun"],
        ["bun.lockb", "bun"],
        ["yarn.lock", "yarn"],
        ["package-lock.json", "npm"],
        ["pnpm-lock.yaml", "pnpm"],
      ] as const
      const detected = new Set<PackageManagerName>()
      for (const [lockfile, manager] of lockfiles) {
        if (yield* exists(path.join(current, lockfile))) detected.add(manager)
      }

      return {
        root: current,
        manifest,
        expoVersion: expoManifest.version,
        expoCliPath,
        lockfileManagers: [...detected],
      } satisfies ProjectState
    })

    return Project.of({ inspect, readInstalledManifest, installedManifestPath })
  }),
)
