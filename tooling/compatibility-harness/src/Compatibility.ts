import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import type { SurfaceLock } from "./Domain.ts"
import * as Catalog from "./catalog/Catalog.ts"
import * as Surface from "./catalog/Surface.ts"
import * as ExpoInstallation from "./installation/ExpoInstallation.ts"
import * as Expectations from "./policy/Expectations.ts"
import { ExpoRepository } from "./ExpoRepository.ts"
import { HarnessError } from "./HarnessError.ts"
import * as Ownership from "./policy/Ownership.ts"
import * as AppRegistry from "./registry/AppRegistry.ts"
import * as Suites from "./suites/Suites.ts"

const inspect = Effect.fn("Compatibility.inspect")(function* () {
  const snapshot = yield* Catalog.make()
  const installation = yield* ExpoInstallation.inspect(snapshot.catalog)
  const surface = yield* Surface.make(snapshot, installation)
  const [ownershipConfig, surfaceLock, corpus, expectations] = yield* Effect.all(
    [Ownership.load(surface), Ownership.loadSurfaceLock(), Suites.discover(), Expectations.load()],
    { concurrency: "unbounded" },
  )
  const lockIssues = Ownership.lockIssues(surface, surfaceLock)
  if (lockIssues.length > 0) {
    return yield* new HarnessError({ operation: "validate surface lock", cause: lockIssues })
  }
  const ownership = yield* Ownership.materialize(surface, ownershipConfig)
  return { snapshot, installation, surface, ownershipConfig, ownership, corpus, expectations }
})

export const generate = Effect.fn("Compatibility.generate")(function* () {
  const repository = yield* ExpoRepository
  const state = yield* inspect()
  const output = yield* repository.writeArtifact(
    "compatibility/catalog.json",
    `${JSON.stringify(state.snapshot, null, 2)}\n`,
  )
  const installationOutput = yield* repository.writeArtifact(
    "compatibility/expo-installation.json",
    `${JSON.stringify(state.installation, null, 2)}\n`,
  )
  const surfaceOutput = yield* repository.writeArtifact(
    "compatibility/surface.json",
    `${JSON.stringify(state.surface, null, 2)}\n`,
  )
  const ownershipOutput = yield* repository.writeArtifact(
    "compatibility/ownership-ledger.json",
    `${JSON.stringify(state.ownership, null, 2)}\n`,
  )
  const corpusOutput = yield* repository.writeArtifact(
    "compatibility/test-corpus.json",
    `${JSON.stringify(state.corpus, null, 2)}\n`,
  )
  const registry = yield* AppRegistry.generate(
    state.corpus,
    state.surface,
    Ownership.replacements(state.ownershipConfig),
    state.ownership.fingerprint,
  )
  yield* Console.log(`Generated ${output}`)
  yield* Console.log(`Generated ${installationOutput}`)
  yield* Console.log(`Generated ${surfaceOutput}`)
  yield* Console.log(`Generated ${ownershipOutput}`)
  yield* Console.log(`Generated ${corpusOutput}`)
  yield* Console.log(
    `Generated ${registry.directory} (${registry.sources} sources; ${registry.appRunnableSources} app-runnable; ${registry.executableRunnerPlans} executable runner plans; ${registry.blockedRunnerPlans} reviewed blockers)`,
  )
  yield* Effect.forEach(
    registry.expoCompatEntrypoints,
    (entrypoint) => Console.log(`Generated ${entrypoint}`),
    { discard: true },
  )
})

export const updateSurfaceLock = Effect.fn("Compatibility.updateSurfaceLock")(function* () {
  const repository = yield* ExpoRepository
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const snapshot = yield* Catalog.make()
  const installation = yield* ExpoInstallation.inspect(snapshot.catalog)
  const surface = yield* Surface.make(snapshot, installation)
  const lock: SurfaceLock = {
    schemaVersion: 1,
    expoRevision: surface.expoRevision,
    surfaceFingerprint: surface.fingerprint,
    surfaceIds: surface.exports.map((entry) => entry.id),
  }
  const output = path.join(repository.root, "compatibility/surface-lock.json")
  yield* fs
    .writeFileString(output, `${JSON.stringify(lock, null, 2)}\n`)
    .pipe(
      Effect.mapError(
        (cause) => new HarnessError({ operation: "write surface lock", path: output, cause }),
      ),
    )
  yield* Console.log(`Updated ${output}`)
})

export const validate = Effect.fn("Compatibility.validate")(function* () {
  const state = yield* inspect()
  const blockingIssues = ExpoInstallation.blockingIssues(state.installation)
  if (blockingIssues.length > 0) {
    return yield* new HarnessError({
      operation: "validate Expo installation",
      cause: blockingIssues,
    })
  }
  yield* Console.log(
    `Validated Expo ${state.snapshot.catalog.expoRevision.slice(0, 12)} with ${state.snapshot.catalog.packages.length} packages`,
  )
  return undefined
})

export const doctor = Effect.fn("Compatibility.doctor")(function* () {
  const state = yield* inspect()
  const counts = new Map<string, number>()
  for (const entry of state.installation.packages) {
    counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1)
  }
  const expandedEntrypoints = state.installation.packages.reduce(
    (total, entry) => total + entry.expandedEntrypoints.length,
    0,
  )
  const issues = ExpoInstallation.issues(state.installation)
  const registryDifferences = ExpoInstallation.registryDifferences(state.installation)
  yield* Console.log(
    [
      "Expo installation",
      `  ${state.installation.packages.length} expected packages`,
      `  ${counts.get("valid") ?? 0} valid`,
      `  ${expandedEntrypoints} wildcard entrypoints expanded`,
      ...(registryDifferences.length === 0
        ? []
        : [
            "",
            `Registry comparison: ${registryDifferences.length} published revisions differ from the pinned target (non-blocking; details are recorded in the generated ExpoInstallation artifact)`,
          ]),
      ...(issues.length === 0 ? ["", "✓ Expo installation is valid"] : ["", ...issues]),
    ].join("\n"),
  )
})

export const matrix = Effect.fn("Compatibility.matrix")(function* () {
  const state = yield* inspect()
  const entrypoints = state.snapshot.catalog.packages.reduce(
    (total, packageEntry) => total + packageEntry.entrypoints.length,
    0,
  )
  const cases = state.corpus.cases.length
  yield* Console.log(
    [
      `Expo revision:       ${state.snapshot.catalog.expoRevision}`,
      `Effect revision:     ${state.snapshot.catalog.effectRevision}`,
      `Catalog fingerprint: ${state.snapshot.fingerprint}`,
      `Packages:            ${state.snapshot.catalog.packages.length}`,
      `Entrypoints:         ${entrypoints}`,
      `Installed packages:  ${state.installation.packages.length}`,
      `Expanded wildcards:  ${state.installation.packages.reduce(
        (total, entry) => total + entry.expandedEntrypoints.length,
        0,
      )}`,
      `Surface exports:     ${state.surface.exports.length}`,
      `Ownership entries:   ${state.ownership.entries.length}`,
      `Expectations:        ${state.expectations.entries.length}`,
      `Test sources:        ${state.corpus.sources.length}`,
      `Static test cases:   ${cases}`,
    ].join("\n"),
  )
})
