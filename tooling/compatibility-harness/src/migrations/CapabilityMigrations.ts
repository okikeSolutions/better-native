import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { HarnessError } from "../HarnessError.ts"

const Platform = Schema.Literals(["web", "ios", "android"])

const IntegrationSuite = Schema.Literals(["published", "eval-controls", "compile-contracts"])

const Verification = Schema.Struct({
  unitProject: Schema.NonEmptyString,
  coverageScope: Schema.NonEmptyString,
  integrationSuites: Schema.Array(IntegrationSuite),
  parityPlatforms: Schema.Array(Platform),
})

const Requirements = Schema.Struct({
  platforms: Schema.Array(Platform),
  dxEval: Schema.Boolean,
  events: Schema.Boolean,
  hooks: Schema.Boolean,
  configPlugin: Schema.Boolean,
  backgroundExecution: Schema.Boolean,
  physicalDevice: Schema.Boolean,
})

export const Capability = Schema.Struct({
  id: Schema.NonEmptyString,
  expoPackage: Schema.NonEmptyString,
  candidatePackage: Schema.NonEmptyString,
  compatibilitySource: Schema.NonEmptyString,
  expoSubpaths: Schema.NonEmptyArray(Schema.NonEmptyString),
  requirements: Requirements,
  verification: Verification,
})
export type Capability = Schema.Schema.Type<typeof Capability>

export const CapabilityLedger = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  capabilities: Schema.Array(Capability),
})
export type CapabilityLedger = Schema.Schema.Type<typeof CapabilityLedger>

export interface MigrationCheck {
  readonly name: string
  readonly complete: boolean
  readonly detail: string
}

export interface MigrationStatus {
  readonly id: string
  readonly ownership: "effect" | "fallback" | "mixed" | "missing"
  readonly promotable: boolean
  readonly checks: ReadonlyArray<MigrationCheck>
  readonly requirements: Capability["requirements"]
}

const json = (text: string, path: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => new HarnessError({ operation: "parse migration input", path, cause }),
  })

const readText = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs
      .readFileString(path)
      .pipe(
        Effect.mapError(
          (cause) => new HarnessError({ operation: "read migration input", path, cause }),
        ),
      )
  })

const readJson = (path: string) => readText(path).pipe(Effect.flatMap((text) => json(text, path)))

const exists = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.exists(path)
  })

const contains = (path: string, value: string) =>
  readText(path).pipe(
    Effect.map((text) => text.includes(value)),
    Effect.catch(() => Effect.succeed(false)),
  )

const check = (name: string, complete: boolean, detail: string): MigrationCheck => ({
  name,
  complete,
  detail,
})

interface OwnershipInput {
  readonly overrides?: ReadonlyArray<{
    readonly package?: string
    readonly subpath?: string
    readonly status?: string
    readonly replacement?: string | null
  }>
}

interface MappingsInput {
  readonly mappings?: ReadonlyArray<{ readonly package?: string }>
  readonly typeMappings?: ReadonlyArray<{ readonly package?: string }>
}

interface ReplacementsInput {
  readonly replacements?: ReadonlyArray<{
    readonly source?: string
    readonly target?: string
  }>
}

interface PackageInput {
  readonly name?: string
  readonly exports?: Readonly<Record<string, unknown>>
  readonly scripts?: Readonly<Record<string, string>>
}

interface TaskInput {
  readonly id?: string
  readonly taskType?: string
  readonly publicPackages?: ReadonlyArray<string>
}

const ownershipStatusOf = (
  overrides: ReadonlyArray<{ readonly status?: string }>,
): MigrationStatus["ownership"] => {
  if (overrides.length === 0) return "missing"
  const owners = new Set(overrides.map((entry) => entry.status))
  if (owners.size === 1 && owners.has("effect")) return "effect"
  if (owners.size === 1 && owners.has("fallback")) return "fallback"
  return "mixed"
}

/** Derives the migration checklist from reviewed capability requirements and repository files. */
export const inspect = Effect.fn("CapabilityMigrations.inspect")(function* (
  repositoryRoot = process.cwd(),
) {
  const path = yield* Path.Path
  const resolve = (relative: string) => path.join(repositoryRoot, relative)
  const ledgerValue = yield* readJson(resolve("compatibility/capabilities.json"))
  const ledger = yield* Schema.decodeUnknownEffect(CapabilityLedger)(ledgerValue).pipe(
    Effect.mapError(
      (cause) =>
        new HarnessError({
          operation: "decode capability migration ledger",
          path: "compatibility/capabilities.json",
          cause,
        }),
    ),
  )
  const ids = new Set<string>()
  const expoPackages = new Set<string>()
  for (const capability of ledger.capabilities) {
    if (ids.has(capability.id)) {
      return yield* new HarnessError({
        operation: "validate capability migration ledger",
        cause: `duplicate capability id ${capability.id}`,
      })
    }
    if (expoPackages.has(capability.expoPackage)) {
      return yield* new HarnessError({
        operation: "validate capability migration ledger",
        cause: `duplicate Expo package ${capability.expoPackage}`,
      })
    }
    ids.add(capability.id)
    expoPackages.add(capability.expoPackage)
  }

  const ownership = (yield* readJson(resolve("compatibility/ownership.json"))) as OwnershipInput
  const mappings = (yield* readJson(resolve("compatibility/api-mappings.json"))) as MappingsInput
  const replacements = (yield* readJson(
    resolve("apps/compatibility-suite/src/generated/Replacements.json"),
  )) as ReplacementsInput
  const installationTest = resolve(
    "tooling/compatibility-harness/src/installation/PublishedCapabilityPackages.test.ts",
  )
  const taskRegistry = resolve("tooling/dx-evals/src/tasks/TaskRegistry.ts")
  const cliModel = resolve("packages/cli/src/Model.ts")
  const checkWorkflow = resolve(".github/workflows/check.yml")
  const integrationConfig = resolve("vitest.shared.ts")
  const turboConfig = resolve("turbo.json")

  return yield* Effect.forEach(ledger.capabilities, (capability) =>
    Effect.gen(function* () {
      const packageRoot = resolve(`packages/${capability.id}`)
      const packageManifestPath = path.join(packageRoot, "package.json")
      const packageValue = (yield* readJson(packageManifestPath).pipe(
        Effect.catch(() => Effect.succeed({})),
      )) as PackageInput
      const packageExports = packageValue.exports ?? {}
      const candidateEntrypoints = capability.expoSubpaths.map((subpath) =>
        subpath === "." ? "./expo" : subpath,
      )
      const overrides = (ownership.overrides ?? []).filter(
        (entry) => entry.package === capability.expoPackage,
      )
      const ownershipStatus = ownershipStatusOf(overrides)
      const expectedSubpaths = new Set(capability.expoSubpaths)
      const ownedSubpaths = new Set(overrides.map((entry) => entry.subpath))
      const subpathsCovered =
        expectedSubpaths.size === ownedSubpaths.size &&
        [...expectedSubpaths].every((subpath) => ownedSubpaths.has(subpath))
      const replacementCovered = overrides.every(
        (entry) =>
          typeof entry.replacement === "string" &&
          entry.replacement.startsWith(capability.candidatePackage),
      )
      const mapped = [...(mappings.mappings ?? []), ...(mappings.typeMappings ?? [])].some(
        (entry) => entry.package === capability.expoPackage,
      )
      const generated = (replacements.replacements ?? []).some(
        (entry) =>
          entry.source === capability.expoPackage &&
          entry.target === `${capability.candidatePackage}/expo`,
      )
      const evalRoot = resolve(`evals/tasks/${capability.id}`)
      const requiredEvalFiles = capability.requirements.dxEval
        ? [
            `${evalRoot}/instruction.md`,
            `${evalRoot}/task.json`,
            `${evalRoot}/reference.patch`,
            `${evalRoot}/broken.patch`,
            `${evalRoot}/grader/expected.json`,
            resolve(
              `tooling/dx-evals/src/tasks/${capability.compatibilitySource.replace(/\.ts$/, "")}.ts`,
            ),
            resolve(`tooling/dx-evals/evals/${capability.id}.eval.ts`),
            resolve(`tooling/dx-evals/runner/observe-${capability.id}.ts`),
            resolve(`tooling/dx-evals/runner/worker-${capability.id}.ts`),
          ]
        : []
      const missingEvalFiles = yield* Effect.filter(requiredEvalFiles, (file) =>
        exists(file).pipe(Effect.map((present) => !present)),
      )
      const fixturePresent = capability.requirements.dxEval
        ? yield* exists(`${evalRoot}/fixture`)
        : true
      const taskInput = capability.requirements.dxEval
        ? ((yield* readJson(`${evalRoot}/task.json`).pipe(
            Effect.catch(() => Effect.succeed({})),
          )) as TaskInput)
        : undefined
      const taskDefinitionMatches =
        taskInput === undefined ||
        (taskInput.id === capability.id &&
          taskInput.taskType === capability.id &&
          taskInput.publicPackages?.includes(capability.candidatePackage) === true)
      const taskModuleName = capability.compatibilitySource.replace(/\.ts$/, "")
      const expectedCoverageScope = `packages/${capability.id}/src/**/*.ts`
      const packageScriptsPresent =
        packageValue.scripts?.["test:unit"] !== undefined &&
        packageValue.scripts["test:coverage"] !== undefined
      const integrationSuiteRoutes = yield* Effect.all(
        capability.verification.integrationSuites.map((suite) => {
          switch (suite) {
            case "published":
              return contains(integrationConfig, "PublishedCapabilityPackages.test.ts")
            case "eval-controls":
              return Effect.all([
                contains(checkWorkflow, "[.capabilities[].id]"),
                contains(checkWorkflow, "fromJSON(needs.plan.outputs.capabilities)"),
                contains(checkWorkflow, "bun run evals validate --task"),
                contains(turboConfig, `${capability.candidatePackage}#build`),
              ]).pipe(
                Effect.map(
                  ([derived, matrix, command, build]) => derived && matrix && command && build,
                ),
              )
            case "compile-contracts":
              return exists(
                resolve(
                  `tooling/dx-evals/src/agent/compile-contracts/${taskModuleName}CompileContract.test.ts`,
                ),
              )
          }
        }),
      )
      const integrationSuitesRouted = integrationSuiteRoutes.every(Boolean)
      const parityPlatformsMatch =
        capability.verification.parityPlatforms.length ===
          capability.requirements.platforms.length &&
        capability.requirements.platforms.every((platform) =>
          capability.verification.parityPlatforms.includes(platform),
        )
      const registryMentionsTask = capability.requirements.dxEval
        ? yield* contains(taskRegistry, `Match.when("${capability.id}"`)
        : true
      const checks = [
        check("package", packageValue.name === capability.candidatePackage, packageManifestPath),
        check(
          "Expo-compatible entrypoints",
          candidateEntrypoints.every((entrypoint) => Object.hasOwn(packageExports, entrypoint)),
          candidateEntrypoints.join(", "),
        ),
        check(
          "documentation",
          (yield* exists(path.join(packageRoot, "README.md"))) &&
            (yield* exists(path.join(packageRoot, "docgen.json"))),
          `packages/${capability.id}/README.md and docgen.json`,
        ),
        check(
          "host tests",
          yield* exists(path.join(packageRoot, "test")),
          `packages/${capability.id}/test`,
        ),
        check(
          "unit and coverage tasks",
          capability.verification.unitProject === capability.candidatePackage &&
            capability.verification.coverageScope === expectedCoverageScope &&
            packageScriptsPresent,
          capability.verification.coverageScope,
        ),
        check(
          "CI integration routing",
          integrationSuitesRouted,
          capability.verification.integrationSuites.join(", "),
        ),
        check(
          "parity routing",
          parityPlatformsMatch,
          capability.verification.parityPlatforms.join(", "),
        ),
        check(
          "compatibility source",
          yield* exists(
            resolve(`apps/compatibility-suite/src/capabilities/${capability.compatibilitySource}`),
          ),
          capability.compatibilitySource,
        ),
        check(
          "ownership",
          subpathsCovered && replacementCovered,
          `${ownershipStatus}; ${overrides.length}/${expectedSubpaths.size} entrypoints`,
        ),
        check("API mappings", mapped, capability.expoPackage),
        check("generated replacement", generated, `${capability.expoPackage} -> candidate`),
        check(
          "installation coverage",
          yield* contains(installationTest, capability.candidatePackage),
          capability.candidatePackage,
        ),
        check(
          "CLI installer",
          ownershipStatus !== "effect" || (yield* contains(cliModel, `"${capability.id}"`)),
          ownershipStatus === "effect" ? capability.id : "required at effect ownership",
        ),
        check(
          "DX eval files",
          missingEvalFiles.length === 0 && fixturePresent && taskDefinitionMatches,
          missingEvalFiles.length === 0 && fixturePresent && taskDefinitionMatches
            ? capability.id
            : `missing ${[
                ...missingEvalFiles.map((file) => path.relative(repositoryRoot, file)),
                ...(fixturePresent ? [] : [`evals/tasks/${capability.id}/fixture`]),
                ...(taskDefinitionMatches
                  ? []
                  : [`evals/tasks/${capability.id}/task.json metadata`]),
              ].join(", ")}`,
        ),
        check("DX eval registry", registryMentionsTask, taskModuleName),
      ]
      return {
        id: capability.id,
        ownership: ownershipStatus,
        promotable: ownershipStatus === "effect" && checks.every((item) => item.complete),
        checks,
        requirements: capability.requirements,
      } satisfies MigrationStatus
    }),
  )
})

/** Prints a deterministic human-readable migration report. */
export const report = Effect.fn("CapabilityMigrations.report")(function* (
  strict: boolean,
  repositoryRoot = process.cwd(),
) {
  const statuses = yield* inspect(repositoryRoot)
  for (const status of statuses) {
    yield* Console.log(`${status.id} [${status.ownership}]`)
    for (const item of status.checks) {
      yield* Console.log(`  ${item.complete ? "ok" : "missing"}  ${item.name}: ${item.detail}`)
    }
    yield* Console.log(`  promotable: ${status.promotable ? "yes" : "no"}`)
  }
  const incomplete = statuses.flatMap((status) =>
    status.checks.filter((item) => !item.complete).map((item) => `${status.id}: ${item.name}`),
  )
  if (strict && incomplete.length > 0) {
    return yield* new HarnessError({
      operation: "validate capability migrations",
      cause: incomplete,
    })
  }
  return statuses
})
