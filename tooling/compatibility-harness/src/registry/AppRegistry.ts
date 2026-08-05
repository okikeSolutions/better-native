import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import ts from "typescript"
import {
  RegistryMetadata,
  type ExecutionUnit,
  type CorpusSnapshot,
  type RegistryMetadata as RegistryMetadataType,
  type SurfaceSnapshot,
  type TestCaseId,
  type TestSource,
  type TestSourceId,
} from "../Domain.ts"
import { ExpoRepository } from "../ExpoRepository.ts"
import { HarnessError } from "../HarnessError.ts"
import * as RunnerPlans from "./RunnerPlans.ts"

const platforms = ["web", "ios", "android"] as const
type Platform = (typeof platforms)[number]

const executionRunner = (platform: Platform): ExecutionUnit["runner"] =>
  Match.value(platform).pipe(
    Match.when("web", () => "web-app" as const),
    Match.whenOr("ios", "android", () => "native-app" as const),
    Match.exhaustive,
  )

/**
 * Selects the source variant used when an exact platform file is unavailable.
 *
 * @remarks
 * Native is preferred for iOS and Android, then the platform-neutral source.
 * The fallback is metadata selection only; platform support is checked again
 * before a source becomes runnable.
 *
 * @param platform - Target execution platform.
 * @param native - Native source variant, if discovered.
 * @param base - Platform-neutral source variant, if discovered.
 * @returns The source selected for metadata and registry generation.
 */
const platformFallback = (
  platform: Platform,
  native: TestSource | undefined,
  base: TestSource | undefined,
): TestSource | undefined =>
  Match.value(platform).pipe(
    Match.when("web", () => base),
    Match.whenOr("ios", "android", () => native ?? base),
    Match.exhaustive,
  )

const metadataPlatformFallback = (
  platform: Platform,
  native: RegistryMetadataType["sources"][number] | undefined,
  base: RegistryMetadataType["sources"][number] | undefined,
): RegistryMetadataType["sources"][number] | undefined =>
  Match.value(platform).pipe(
    Match.when("web", () => base),
    Match.whenOr("ios", "android", () => native ?? base),
    Match.exhaustive,
  )

const unitId = (platform: Platform, sourceId: TestSourceId): string => {
  let hash = 2166136261
  for (const character of sourceId) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const stem = sourceId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 72)
  return `${platform}-${stem}-${(hash >>> 0).toString(16)}`
}

/** Versioned candidate replacements and the ownership fingerprint that authorized them. */
export const ReplacementManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  ownershipFingerprint: Schema.String,
  replacements: Schema.Array(
    Schema.Struct({ source: Schema.NonEmptyString, target: Schema.NonEmptyString }),
  ),
  trackedSpecifiers: Schema.Array(Schema.String),
})
/** Decoded replacement manifest accepted by {@link ReplacementManifest}. */
export type ReplacementManifest = Schema.Schema.Type<typeof ReplacementManifest>

const platformVariant = (file: string): Platform | "native" | null => {
  const match = file.match(/\.(android|ios|native|web)\.[^.]+$/)
  switch (match?.[1]) {
    case "android":
    case "ios":
    case "native":
    case "web":
      return match[1]
    default:
      return null
  }
}

const logicalPath = (file: string): string =>
  file.replace(/\.(android|ios|native|web)(?=\.[^.]+$)/, "")

const moduleStem = (file: string): string => logicalPath(file).replace(/\.[^.]+$/, "")

const upstreamTestModuleStems = (source: string): ReadonlySet<string> =>
  new Set(
    [...source.matchAll(/require\(\s*["']\.\/tests\/([^"']+)["']\s*\)/g)].map(
      ([, test]) => `apps/test-suite/tests/${test}`,
    ),
  )

/**
 * Extracts enabled native E2E module names from Expo's authoritative source list.
 *
 * @remarks
 * Block and line comments are removed before string extraction so disabled tests
 * do not silently enter the native execution cohort.
 *
 * @param source - Source text of Expo's native E2E test-suite manifest.
 * @returns Enabled module names exactly as declared upstream.
 */
export const upstreamNativeE2eNames = (source: string): ReadonlySet<string> => {
  const tests = source.match(/\bconst\s+TESTS\s*=\s*\[([\s\S]*?)\]\s*;/)?.[1]
  if (tests === undefined) return new Set()
  const uncommented = tests.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  return new Set(
    [...uncommented.matchAll(/["'`]([^"'`]+)["'`]/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  )
}

const runtimeName = (source: string): string | null =>
  source.match(/export\s+const\s+name\s*=\s*["'`]([^"'`]+)["'`]/)?.[1] ?? null

const supportsPlatform = (file: string, platform: Platform): boolean => {
  const variant = platformVariant(file)
  return variant === null || variant === platform || (variant === "native" && platform !== "web")
}

const selectPlatformSources = (
  sources: ReadonlyArray<TestSource>,
  platform: Platform,
): ReadonlyArray<TestSource> => {
  const groups = new Map<string, Array<TestSource>>()
  for (const source of sources) {
    const key = logicalPath(source.path)
    const entries = groups.get(key) ?? []
    entries.push(source)
    groups.set(key, entries)
  }
  const selected: Array<TestSource> = []
  for (const entries of groups.values()) {
    const exact = entries.find((source) => platformVariant(source.path) === platform)
    const native = entries.find((source) => platformVariant(source.path) === "native")
    const base = entries.find((source) => platformVariant(source.path) === null)
    const source = exact ?? platformFallback(platform, native, base)
    if (source !== undefined && supportsPlatform(source.path, platform)) selected.push(source)
  }
  return selected.toSorted((left, right) => left.id.localeCompare(right.id))
}

/**
 * Selects registry sources runnable on one platform.
 *
 * @remarks
 * Web accepts registered app sources, while native execution is restricted to
 * Expo's authoritative native E2E selection. Platform variants are collapsed to
 * one logical source before IDs are returned.
 *
 * @param metadata - Generated application registry metadata.
 * @param platform - Execution platform to select.
 * @returns Deterministically sorted runnable source identifiers.
 */
export const runnableSourceIds = (
  metadata: RegistryMetadataType,
  platform: Platform,
): ReadonlyArray<TestSourceId> => {
  const groups = new Map<string, Array<RegistryMetadataType["sources"][number]>>()
  const nativeE2eSourceIds = new Set(metadata.nativeE2eSourceIds)
  for (const source of metadata.sources.filter(
    ({ sourceId, registration }) =>
      registration !== "external" &&
      Match.value(platform).pipe(
        Match.when("web", () => true),
        Match.whenOr("ios", "android", () => nativeE2eSourceIds.has(sourceId)),
        Match.exhaustive,
      ),
  )) {
    const key = logicalPath(source.path)
    const entries = groups.get(key) ?? []
    entries.push(source)
    groups.set(key, entries)
  }
  const selected: Array<TestSourceId> = []
  for (const entries of groups.values()) {
    const exact = entries.find((source) => platformVariant(source.path) === platform)
    const native = entries.find((source) => platformVariant(source.path) === "native")
    const base = entries.find((source) => platformVariant(source.path) === null)
    const source = exact ?? metadataPlatformFallback(platform, native, base)
    if (source !== undefined && supportsPlatform(source.path, platform)) {
      selected.push(source.sourceId)
    }
  }
  return selected.toSorted()
}

/**
 * Produces source-sized execution units for a platform.
 *
 * @remarks
 * Unit IDs are safe evidence-path segments; source IDs remain unmodified so the
 * generated app can resolve them from its static registry.
 *
 * @param metadata - Generated application registry metadata.
 * @param platform - Execution platform to select.
 * @returns One execution unit per runnable logical source.
 */
export const appExecutionUnits = (
  metadata: RegistryMetadataType,
  platform: Platform,
): ReadonlyArray<ExecutionUnit> =>
  runnableSourceIds(metadata, platform).map((sourceId) => ({
    id: unitId(platform, sourceId),
    runner: executionRunner(platform),
    platform,
    sourceId,
  }))

/**
 * Balances complete source units across native shards by discovered case weight.
 *
 * @remarks
 * A source is never split because the generated app registry is the authority
 * for execution and case discovery. Sorting by weight and source ID keeps shard
 * assignment deterministic while greedy placement limits skew.
 *
 * @param metadata - Generated registry metadata containing source case counts.
 * @param platform - Native platform whose units should be sharded.
 * @param shardCount - Number of output shards.
 * @returns Shards containing whole execution units in deterministic order.
 */
export const appExecutionShards = (
  metadata: RegistryMetadataType,
  platform: Platform,
  shardCount: number,
): ReadonlyArray<ReadonlyArray<ExecutionUnit>> => {
  const weights = new Map(
    metadata.sources.map(({ sourceId, caseIds }) => [sourceId, Math.max(1, caseIds.length)]),
  )
  const shards = Array.from({ length: shardCount }, () => ({
    weight: 0,
    units: [] as Array<ExecutionUnit>,
  }))
  for (const unit of appExecutionUnits(metadata, platform).toSorted(
    (left, right) =>
      (weights.get(right.sourceId) ?? 1) - (weights.get(left.sourceId) ?? 1) ||
      left.sourceId.localeCompare(right.sourceId),
  )) {
    const shard = shards.reduce((lightest, candidate) =>
      candidate.weight < lightest.weight ? candidate : lightest,
    )
    shard.units.push(unit)
    shard.weight += weights.get(unit.sourceId) ?? 1
  }
  return shards.map(({ units }) =>
    units.toSorted((left, right) => left.sourceId.localeCompare(right.sourceId)),
  )
}

/**
 * Loads generated compatibility-app registry metadata.
 *
 * @returns The decoded registry metadata.
 * @throws {@link HarnessError} when reading, parsing, or decoding fails.
 */
export const loadMetadata = Effect.fn("AppRegistry.loadMetadata")(function* () {
  const fs = yield* FileSystem.FileSystem
  const file = "apps/compatibility-suite/src/generated/RegistryMetadata.json"
  return yield* fs.readFileString(file).pipe(
    Effect.mapError(
      (cause) => new HarnessError({ operation: "read registry metadata", path: file, cause }),
    ),
    Effect.flatMap((text) =>
      Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (cause) =>
          new HarnessError({ operation: "parse registry metadata", path: file, cause }),
      }),
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(RegistryMetadata)),
    Effect.mapError((cause) =>
      cause instanceof HarnessError
        ? cause
        : new HarnessError({ operation: "decode registry metadata", path: file, cause }),
    ),
  )
})

/**
 * Loads the generated candidate replacement manifest.
 *
 * @returns The decoded manifest bound to a reviewed ownership fingerprint.
 * @throws {@link HarnessError} when the generated file is unavailable or invalid.
 */
export const loadReplacementManifest = Effect.fn("AppRegistry.loadReplacementManifest")(
  function* () {
    const repository = yield* ExpoRepository
    return yield* repository.readJson(
      "apps/compatibility-suite/src/generated/Replacements.json",
      ReplacementManifest,
    )
  },
)

/**
 * Loads the generated external runner-plan ledger.
 *
 * @returns The decoded disposition for every non-app source.
 * @throws {@link HarnessError} when the generated ledger is unavailable or invalid.
 */
export const loadRunnerPlanLedger = Effect.fn("AppRegistry.loadRunnerPlanLedger")(function* () {
  const repository = yield* ExpoRepository
  return yield* repository.readJson(
    "apps/compatibility-suite/src/generated/RunnerPlanLedger.json",
    RunnerPlans.RunnerPlanLedgerSchema,
  )
})

const isEager = (source: TestSource): boolean =>
  /\/(?:Location|TaskManager)(?:\.(?:android|ios|native|web))?\.[^.]+$/.test(source.path)

const registration = (source: TestSource, appRunnable: boolean) => {
  if (!appRunnable) return "external" as const
  return isEager(source) ? ("eager" as const) : ("lazy" as const)
}

const execution = (
  source: TestSource,
  appRunnable: boolean,
): RegistryMetadataType["sources"][number]["execution"] => {
  if (appRunnable) return "native-app"
  if (source.executability === "non-executable") return "unsupported"
  switch (source.runner) {
    case "jest":
    case "node-test":
    case "bun-test":
    case "playwright":
    case "detox":
      return "javascript-runner"
    case "xctest":
      return "xctest"
    case "gradle-unit":
    case "gradle-instrumentation":
      return "gradle"
    case "maestro":
      return "native-app"
    case "workflow":
      return "build"
    case "expo-jasmine":
      return "unsupported"
  }
  return "unsupported"
}

const expoTestModule = (source: TestSource): string => `@better-native/expo-source/${source.path}`

const specifierOf = (entry: SurfaceSnapshot["exports"][number]) =>
  entry.subpath === "." ? entry.package : `${entry.package}/${entry.subpath.slice(2)}`

const surfaceProbeSource = (): string =>
  [
    'import type { SurfaceProbes } from "../SurfaceProbes.ts"',
    "",
    "// The supervisor replaces this file only inside an isolated probe workspace.",
    "export const surfaceProbes: SurfaceProbes = new Map()",
    "",
  ].join("\n")

const upstreamSelectionSource = (): string =>
  [
    'import { configureUpstreamSelection } from "../Registry.ts"',
    "",
    "// Kept in an app-only module: invoking the pinned function preserves its",
    "// platform, Expo Go, device-farm, WebGL, optional-module and eager-load gates.",
    'const upstream: unknown = require("@better-native/expo-source/apps/test-suite/TestModules")',
    'const getter: unknown = typeof upstream === "object" && upstream !== null',
    '  ? Reflect.get(upstream, "getTestModules")',
    "  : undefined",
    'if (typeof getter !== "function") throw new Error("Pinned Expo TestModules.getTestModules is unavailable")',
    "const modules: unknown = Reflect.apply(getter, upstream, [])",
    'if (!Array.isArray(modules)) throw new Error("Pinned Expo getTestModules returned a non-array")',
    "const names = modules.flatMap((module: unknown) => {",
    '  if (typeof module !== "object" || module === null) return []',
    '  const name: unknown = Reflect.get(module, "name")',
    '  return typeof name === "string" ? [name] : []',
    "})",
    "configureUpstreamSelection(names)",
    "",
  ].join("\n")

const loaderSource = (
  platform: Platform,
  sources: ReadonlyArray<TestSource>,
  jasmineSources: ReadonlySet<string>,
): string => {
  const selected = selectPlatformSources(
    sources.filter((source) => jasmineSources.has(source.id)),
    platform,
  )
  const entries = selected.map(
    (source) =>
      `  [${JSON.stringify(source.id)}, () => require(${JSON.stringify(expoTestModule(source))}) as unknown],`,
  )
  return [
    'import type { RegistryLoaders } from "../Registry.ts"',
    "",
    "export const loaders: RegistryLoaders = new Map([",
    ...entries,
    "]) as RegistryLoaders",
    "",
  ].join("\n")
}

const eagerSource = (
  platform: Platform,
  sources: ReadonlyArray<TestSource>,
  jasmineSources: ReadonlySet<string>,
): string => {
  const selected = selectPlatformSources(
    sources.filter((source) => jasmineSources.has(source.id) && isEager(source)),
    platform,
  )
  return [
    ...selected.map((source) => `require(${JSON.stringify(expoTestModule(source))})`),
    "",
    `export const eagerSourceIds = ${JSON.stringify(selected.map(({ id }) => id))} as const`,
    "",
  ].join("\n")
}

const failure = (operation: string, path: string, cause: unknown): HarnessError =>
  new HarnessError({ operation, path, cause })

/**
 * Synchronizes a generated directory with an exact output map.
 *
 * @remarks
 * Obsolete regular files are removed, but unexpected directories or special
 * entries fail closed so generation cannot recursively delete user data.
 *
 * @param directory - Existing generated-output directory.
 * @param outputs - Exact filename-to-content map that should remain.
 * @returns An Effect that completes after synchronization.
 * @throws {@link HarnessError} for unsafe obsolete entries or failed writes.
 */
export const writeGeneratedOutputs = Effect.fn("AppRegistry.writeGeneratedOutputs")(function* (
  directory: string,
  outputs: ReadonlyMap<string, string>,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const existing = yield* fs.readDirectory(directory)
  for (const name of existing) {
    if (outputs.has(name)) continue
    const target = path.join(directory, name)
    const info = yield* fs.stat(target)
    if (info.type !== "File") {
      return yield* failure(
        "synchronize app registry",
        target,
        "obsolete generated entry is not a regular file",
      )
    }
    yield* fs.remove(target)
  }
  yield* Effect.forEach(outputs, ([name, value]) => {
    const output = path.join(directory, name)
    return fs
      .writeFileString(output, value)
      .pipe(Effect.mapError((cause) => failure("write app registry", output, cause)))
  })
  return undefined
})

type ExportKind = "type" | "value" | "both"

const mergeExportKind = (left: ExportKind | undefined, right: ExportKind): ExportKind => {
  if (left === undefined || left === right) return right
  return "both"
}

/**
 * Extracts runtime and type exports from one Expo-compatible source module.
 *
 * @remarks
 * The parser intentionally records both declarations and re-exports so the
 * generated compatibility entrypoint can be compared with the locked Expo
 * surface without executing the module.
 *
 * @param sourceText - TypeScript source text for the module.
 * @returns Export names mapped to their observed declaration kind.
 */
const exportedDeclarations = (sourceText: string): Map<string, ExportKind> => {
  const source = ts.createSourceFile("module.ts", sourceText, ts.ScriptTarget.Latest, true)
  const exports = new Map<string, ExportKind>()
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    const isExported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    if (!isExported) continue
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isVariableStatement(statement) ||
        ts.isEnumDeclaration(statement)) &&
      "name" in statement &&
      statement.name !== undefined
    ) {
      const name = statement.name.text
      const kind: ExportKind = ts.isEnumDeclaration(statement) ? "both" : "value"
      exports.set(name, mergeExportKind(exports.get(name), kind))
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.set(
            declaration.name.text,
            mergeExportKind(exports.get(declaration.name.text), "value"),
          )
        }
      }
    } else if (
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      const name = statement.name.text
      exports.set(name, mergeExportKind(exports.get(name), "type"))
    }
  }
  return exports
}

const relativeModulePath = (specifier: string): string | null =>
  specifier.startsWith("./") || specifier.startsWith("../") ? specifier : null

const resolveSourceModule = (path: Path.Path, sourceFile: string, specifier: string): string =>
  path.normalize(path.join(path.dirname(sourceFile), `${specifier}.ts`))

const mainSourceFile = (expoPackage: string, manifest: unknown): string | null => {
  if (typeof manifest !== "object" || manifest === null || !("main" in manifest)) return null
  const main = (manifest as { readonly main?: unknown }).main
  if (typeof main !== "string") return null
  const match = main.match(/^build\/(.+)\.js$/)
  return match === null ? null : `packages/${expoPackage}/src/${match[1]}.ts`
}

const expoCompatSource = Effect.fn("AppRegistry.expoCompatSource")(function* (expoPackage: string) {
  const repository = yield* ExpoRepository
  const path = yield* Path.Path
  const manifest = yield* repository.readExpoJson(
    `packages/${expoPackage}/package.json`,
    Schema.Unknown,
  )
  const entry = mainSourceFile(expoPackage, manifest)
  if (entry === null) {
    return yield* failure(
      "generate Expo-compatible entrypoint",
      `packages/${expoPackage}/package.json`,
      "expected main to point at build/<entry>.js",
    )
  }
  const textByFile = new Map<string, string>()
  const readSource = Effect.fn("AppRegistry.readExportSource")(function* (file: string) {
    const cached = textByFile.get(file)
    if (cached !== undefined) return cached
    const text = yield* repository.readExpoText(file)
    textByFile.set(file, text)
    return text
  })
  const collect = Effect.fn("AppRegistry.collectExports")(function* (file: string) {
    const sourceText = yield* readSource(file)
    const local = exportedDeclarations(sourceText)
    const values = new Set<string>()
    const types = new Set<string>()
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true)
    for (const [name, kind] of local) {
      if (kind === "value" || kind === "both") values.add(name)
      if (kind === "type" || kind === "both") types.add(name)
    }
    for (const statement of source.statements) {
      if (
        !ts.isExportDeclaration(statement) ||
        statement.exportClause === undefined ||
        !ts.isNamedExports(statement.exportClause)
      ) {
        continue
      }
      const moduleSpecifier = statement.moduleSpecifier
      const relative =
        moduleSpecifier !== undefined && ts.isStringLiteral(moduleSpecifier)
          ? relativeModulePath(moduleSpecifier.text)
          : null
      const targetKinds =
        relative === null
          ? new Map<string, ExportKind>()
          : exportedDeclarations(yield* readSource(resolveSourceModule(path, file, relative)))
      for (const element of statement.exportClause.elements) {
        const exported = element.name.text
        const imported = element.propertyName?.text ?? exported
        const typeOnly = statement.isTypeOnly || element.isTypeOnly
        const kind = typeOnly ? "type" : (targetKinds.get(imported) ?? "both")
        if (kind === "value" || kind === "both") values.add(exported)
        if (kind === "type" || kind === "both") types.add(exported)
      }
    }
    return { values: [...values].toSorted(), types: [...types].toSorted() }
  })
  const { values, types } = yield* collect(entry)
  const namespace = expoPackage
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")
  return [
    "// @generated by better-native compatibility harness",
    "// Do not edit manually.",
    `// Source: ${expoPackage} at Expo ${repository.upstreams.expo.revision}`,
    "",
    `import * as ${namespace} from "${expoPackage}"`,
    "",
    ...values.map((name) => `export const ${name} = ${namespace}.${name}`),
    ...(values.length > 0 && types.length > 0 ? [""] : []),
    ...types.map((name) => `export type ${name} = ${namespace}.${name}`),
    "",
  ].join("\n")
})

const generatedExpoCompatTargets = (
  replacements: ReadonlyArray<{ readonly source: string; readonly target: string }>,
): ReadonlyArray<{ readonly source: string; readonly path: string }> =>
  replacements.flatMap(({ source, target }) => {
    const match = target.match(/^@better-native\/([^/]+)\/expo$/)
    return match?.[1] === undefined ? [] : [{ source, path: `packages/${match[1]}/src/Expo.ts` }]
  })

const writeExpoCompatEntrypoints = Effect.fn("AppRegistry.writeExpoCompatEntrypoints")(function* (
  replacements: ReadonlyArray<{ readonly source: string; readonly target: string }>,
) {
  const repository = yield* ExpoRepository
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  for (const target of generatedExpoCompatTargets(replacements)) {
    const output = path.join(repository.root, target.path)
    const source = yield* expoCompatSource(target.source)
    yield* fs
      .writeFileString(output, source)
      .pipe(
        Effect.mapError((cause) =>
          failure("write generated Expo-compatible entrypoint", output, cause),
        ),
      )
  }
})

/**
 * Generates the application registry, replacement manifest, runner ledger, and compat entrypoints.
 *
 * @remarks
 * Source selection remains tied to Expo's authoritative manifests. Every corpus
 * source becomes app-runnable, externally executable, or explicitly blocked.
 * Generated Expo-compatible entrypoints are derived from pinned source exports.
 *
 * @param corpus - Complete discovered Expo test corpus.
 * @param surface - Locked Expo export surface.
 * @param replacements - Reviewed candidate module replacements.
 * @param ownershipFingerprint - Fingerprint authorizing the replacement set.
 * @returns Counts and paths for the generated outputs.
 * @throws {@link HarnessError} when source discovery, validation, or writing fails.
 */
export const generate = Effect.fn("AppRegistry.generate")(function* (
  corpus: CorpusSnapshot,
  surface: SurfaceSnapshot,
  replacements: ReadonlyArray<{ readonly source: string; readonly target: string }>,
  ownershipFingerprint: string,
) {
  const repository = yield* ExpoRepository
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const appSources = corpus.sources.filter((source) => source.runner === "expo-jasmine")
  const sourceText = yield* Effect.forEach(
    appSources,
    (source) =>
      repository.readExpoText(source.path).pipe(Effect.map((text) => [source.id, text] as const)),
    { concurrency: 16 },
  )
  const testModulesSource = yield* repository.readExpoText("apps/test-suite/TestModules.ts")
  const nativeE2eSource = yield* repository.readExpoText(
    "apps/bare-expo/e2e/TestSuite-test.native.js",
  )
  const authoritativeStems = upstreamTestModuleStems(testModulesSource)
  const nativeE2eNames = upstreamNativeE2eNames(nativeE2eSource)
  const sourceTextById = new Map(sourceText)
  const jasmineSources = new Set(
    sourceText
      .filter(([, text]) => /export\s+(?:async\s+)?function\s+test\b/.test(text))
      .filter(([, text]) => /export\s+const\s+name\b/.test(text))
      .map(([id]) => id),
  )
  const casesBySource = new Map<string, Array<TestCaseId>>()
  for (const testCase of corpus.cases) {
    const cases = casesBySource.get(testCase.sourceId) ?? []
    cases.push(testCase.id)
    casesBySource.set(testCase.sourceId, cases)
  }
  const sources: RegistryMetadataType["sources"] = corpus.sources.map((source) => {
    const appRunnable = jasmineSources.has(source.id)
    const name = appRunnable ? runtimeName(sourceTextById.get(source.id) ?? "") : null
    const authority =
      source.runner === "expo-jasmine" && authoritativeStems.has(moduleStem(source.path))
        ? ("upstream-selected" as const)
        : ("supplemental" as const)
    return {
      sourceId: source.id,
      path: source.path,
      caseIds: casesBySource.get(source.id) ?? [],
      runner: source.runner,
      execution: execution(source, appRunnable),
      platforms: source.platforms,
      executability: source.executability,
      registration: registration(source, appRunnable),
      authority,
      runtimeName: name,
      reason: appRunnable
        ? null
        : (source.reason ?? `requires the ${source.runner} external runner adapter`),
    }
  })
  const matchedNativeE2eNames = new Set(
    sources.flatMap(({ runtimeName: name }) =>
      name !== null && nativeE2eNames.has(name) ? [name] : [],
    ),
  )
  const missingNativeE2eNames = [...nativeE2eNames].filter(
    (name) => !matchedNativeE2eNames.has(name),
  )
  if (nativeE2eNames.size === 0 || missingNativeE2eNames.length > 0) {
    return yield* failure(
      "derive pinned Expo native E2E cohort",
      "apps/bare-expo/e2e/TestSuite-test.native.js",
      nativeE2eNames.size === 0
        ? "the upstream TESTS list is empty or could not be parsed"
        : `unregistered test modules: ${missingNativeE2eNames.join(", ")}`,
    )
  }
  const metadata: RegistryMetadataType = {
    schemaVersion: 1,
    expoRevision: corpus.expoRevision,
    corpusFingerprint: corpus.fingerprint,
    surfaceFingerprint: surface.fingerprint,
    trackedSpecifiers: [...new Set(surface.exports.map(specifierOf))].toSorted(),
    nativeE2eSourceIds: sources
      .filter(({ runtimeName: name }) => name !== null && nativeE2eNames.has(name))
      .map(({ sourceId }) => sourceId),
    sources,
  }
  const runnerPlans = RunnerPlans.make(corpus, jasmineSources)
  const runnerPlanIssues = RunnerPlans.issues(corpus, runnerPlans, jasmineSources)
  if (runnerPlanIssues.length > 0) {
    return yield* failure(
      "generate runner plan ledger",
      "compatibility/suites.json",
      runnerPlanIssues,
    )
  }
  const directory = path.join(repository.root, "apps/compatibility-suite/src/generated")
  yield* fs
    .makeDirectory(directory, { recursive: true })
    .pipe(Effect.mapError((cause) => failure("create app registry directory", directory, cause)))
  const outputs = new Map<string, string>([
    ["RunnerPlanLedger.json", `${JSON.stringify(runnerPlans, null, 2)}\n`],
    ["RegistryMetadata.json", `${JSON.stringify(metadata, null, 2)}\n`],
    [
      "RegistryMetadata.ts",
      [
        "export const metadata: {",
        "  readonly schemaVersion: 1",
        "  readonly expoRevision: string",
        "  readonly corpusFingerprint: string",
        "  readonly surfaceFingerprint: string",
        "  readonly trackedSpecifiers: ReadonlyArray<string>",
        "  readonly nativeE2eSourceIds: ReadonlyArray<string>",
        "  readonly sources: ReadonlyArray<{",
        "    readonly sourceId: string",
        "    readonly path: string",
        "    readonly caseIds: ReadonlyArray<string>",
        "    readonly runner: string",
        '    readonly execution: "native-app" | "web-app" | "javascript-runner" | "xctest" | "gradle" | "build" | "unsupported"',
        "    readonly platforms: ReadonlyArray<string>",
        "    readonly executability: string",
        '    readonly registration: "eager" | "lazy" | "external"',
        '    readonly authority: "upstream-selected" | "supplemental"',
        "    readonly runtimeName: string | null",
        "    readonly reason: string | null",
        "  }>",
        `} = ${JSON.stringify(metadata, null, 2)}`,
        "",
      ].join("\n"),
    ],
    [
      "Replacements.json",
      `${JSON.stringify({ schemaVersion: 1, expoRevision: corpus.expoRevision, ownershipFingerprint, replacements, trackedSpecifiers: metadata.trackedSpecifiers }, null, 2)}\n`,
    ],
    [
      "SurfaceProbeCatalog.json",
      `${JSON.stringify(
        {
          schemaVersion: 1,
          expoRevision: corpus.expoRevision,
          probes: surface.exports
            .filter(({ kind }) => kind === "opaque-module")
            .map((entry) => ({ specifier: specifierOf(entry), platforms: entry.platforms }))
            .filter(
              (entry, index, entries) =>
                entries.findIndex(({ specifier }) => specifier === entry.specifier) === index,
            )
            .toSorted((left, right) => left.specifier.localeCompare(right.specifier)),
        },
        null,
        2,
      )}\n`,
    ],
    ...platforms.map(
      (platform) =>
        [
          `RegistryLoaders.${platform}.ts`,
          loaderSource(platform, appSources, jasmineSources),
        ] as const,
    ),
    ...platforms.map(
      (platform) =>
        [
          `EagerRegistrations.${platform}.ts`,
          eagerSource(platform, appSources, jasmineSources),
        ] as const,
    ),
    ...platforms.map((platform) => [`SurfaceProbes.${platform}.ts`, surfaceProbeSource()] as const),
    [
      "RegistryLoaders.ts",
      'import { loaders as webLoaders } from "./RegistryLoaders.web.ts"\n\nexport const loaders = webLoaders\n',
    ],
    [
      "EagerRegistrations.ts",
      'import { eagerSourceIds as webEagerSourceIds } from "./EagerRegistrations.web.ts"\n\nexport const eagerSourceIds = webEagerSourceIds\n',
    ],
    [
      "SurfaceProbes.ts",
      'import { surfaceProbes as webSurfaceProbes } from "./SurfaceProbes.web.ts"\n\nexport const surfaceProbes = webSurfaceProbes\n',
    ],
    ["UpstreamSelection.ts", upstreamSelectionSource()],
  ])
  yield* writeGeneratedOutputs(directory, outputs)
  yield* writeExpoCompatEntrypoints(replacements)
  const expoCompatEntrypoints = generatedExpoCompatTargets(replacements).map((target) =>
    path.join(repository.root, target.path),
  )
  return {
    directory,
    expoCompatEntrypoints,
    sources: metadata.sources.length,
    appRunnableSources: jasmineSources.size,
    executableRunnerPlans: runnerPlans.entries.filter(({ status }) => status === "executable")
      .length,
    blockedRunnerPlans: runnerPlans.entries.filter(({ status }) => status === "blocked").length,
  }
})
