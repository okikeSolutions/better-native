import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import ts from "typescript"
import { ExpoRepository, GitRevision } from "./ExpoRepository.ts"
import { HarnessError } from "./HarnessError.ts"

type CoverageStatus =
  | "effect-api"
  | "effect-stream"
  | "expo-compat"
  | "intentional-divergence"
  | "missing"

type CoverageEntry = {
  readonly packageName: string
  readonly expoExport: string
  readonly status: CoverageStatus
  readonly target: string | null
  readonly deprecated?: true
  readonly deprecationReason?: string
  readonly atomTarget?: string
  readonly reason?: string
}

type TypeCoverageStatus = "effect-type" | "expo-compat-type" | "intentional-divergence" | "missing"

type TypeCoverageEntry = {
  readonly packageName: string
  readonly expoType: string
  readonly status: TypeCoverageStatus
  readonly target: string | null
  readonly reason?: string
}

type PackageSummary = {
  readonly packageName: string
  readonly expoExports: number
  readonly deprecatedExpoApis: number
  readonly accountedExports: number
  readonly expoTypes: number
  readonly accountedTypes: number
  readonly effectTypes: number
  readonly expoCompatTypes: number
  readonly missingTypes: number
  readonly expoApi: number
  readonly effectApi: number
  readonly effectStream: number
  readonly reactHooks: number
  readonly effectAtoms: number
  readonly intentionalDivergences: number
  readonly missing: number
  readonly status: "complete" | "intentional-divergence" | "missing"
}

export type CoverageReport = {
  readonly schemaVersion: 5
  readonly packages: ReadonlyArray<PackageSummary>
  readonly entries: ReadonlyArray<CoverageEntry>
  readonly typeEntries: ReadonlyArray<TypeCoverageEntry>
}

export type TypeScriptExports = {
  readonly valueNames: ReadonlySet<string>
  readonly typeNames: ReadonlySet<string>
  readonly types: ReadonlyMap<string, string>
  readonly callable: ReadonlySet<string>
}

const TargetMapping = Schema.Struct({
  package: Schema.String,
  expoExport: Schema.String,
  status: Schema.Literals(["effect-api", "effect-stream", "expo-compat"]),
  target: Schema.String,
  deprecated: Schema.optional(Schema.Literal(true)),
  deprecationReason: Schema.optional(Schema.String),
  atomTarget: Schema.optional(Schema.String),
})

const IntentionalDivergenceMapping = Schema.Struct({
  package: Schema.String,
  expoExport: Schema.String,
  status: Schema.Literal("intentional-divergence"),
  reason: Schema.String,
})

const TypeTargetMapping = Schema.Struct({
  package: Schema.String,
  expoType: Schema.String,
  status: Schema.Literals(["effect-type", "expo-compat-type"]),
  target: Schema.String,
})

const IntentionalTypeDivergenceMapping = Schema.Struct({
  package: Schema.String,
  expoType: Schema.String,
  status: Schema.Literal("intentional-divergence"),
  reason: Schema.String,
})

export const CoverageMappings = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  expoRevision: GitRevision,
  mappings: Schema.Array(Schema.Union([TargetMapping, IntentionalDivergenceMapping])),
  typeMappings: Schema.Array(Schema.Union([TypeTargetMapping, IntentionalTypeDivergenceMapping])),
})
type CoverageMapping = Schema.Schema.Type<typeof CoverageMappings>["mappings"][number]
type TypeCoverageMapping = Schema.Schema.Type<typeof CoverageMappings>["typeMappings"][number]

const packageStem = (expoPackage: string): string => expoPackage.replace(/^expo-/, "")

const betterNativePackage = (expoPackage: string): string =>
  `@better-native/${packageStem(expoPackage)}`

const expoCompatPath = (expoPackage: string): string =>
  `packages/${packageStem(expoPackage)}/src/Expo.ts`

const entrypointPath = (expoPackage: string): string =>
  `packages/${packageStem(expoPackage)}/src/index.ts`

const tsconfigPath = (expoPackage: string): string =>
  `packages/${packageStem(expoPackage)}/tsconfig.json`

const expoPublicExports = (source: string) => ({
  values: [...source.matchAll(/^export const ([A-Za-z_$][\w$]*)\s*=/gm)]
    .map((match) => match[1]!)
    .toSorted(),
  types: [...source.matchAll(/^export type ([A-Za-z_$][\w$]*)\s*=/gm)]
    .map((match) => match[1]!)
    .toSorted(),
})

const loadExpoExports = Effect.fn("Coverage.loadExpoExports")(function* (expoPackage: string) {
  const repository = yield* ExpoRepository
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = path.join(repository.root, expoCompatPath(expoPackage))
  const source = yield* fs.readFileString(file).pipe(
    Effect.mapError(
      (cause) =>
        new HarnessError({
          operation: "read generated Expo-compatible entrypoint",
          path: file,
          cause,
        }),
    ),
  )
  return expoPublicExports(source)
})

const loadBetterNativeExports = Effect.fn("Coverage.loadBetterNativeExports")(function* (
  expoPackage: string,
) {
  const repository = yield* ExpoRepository
  const path = yield* Path.Path
  const entryPoint = path.join(repository.root, entrypointPath(expoPackage))
  const tsconfig = path.join(repository.root, tsconfigPath(expoPackage))
  return yield* Effect.try({
    try: () => {
      const configFile = ts.readConfigFile(tsconfig, (fileName) => ts.sys.readFile(fileName))
      if (configFile.error !== undefined) {
        throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"))
      }
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(tsconfig),
        undefined,
        tsconfig,
      )
      if (parsed.errors.length > 0) {
        throw new Error(
          parsed.errors
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
            .join("\n"),
        )
      }
      const program = ts.createProgram({
        rootNames: [...new Set([...parsed.fileNames, entryPoint])],
        options: parsed.options,
        ...(parsed.projectReferences === undefined
          ? {}
          : { projectReferences: parsed.projectReferences }),
      })
      const exportsAt = (sourcePath: string, moduleName: string): TypeScriptExports => {
        const source = program.getSourceFile(sourcePath)
        const checker = program.getTypeChecker()
        if (source === undefined) {
          throw new Error(`TypeScript could not load ${moduleName}`)
        }
        const module = checker.getSymbolAtLocation(source)
        if (module === undefined) {
          throw new Error(`TypeScript could not resolve ${moduleName}`)
        }
        const exportedSymbols = checker.getExportsOfModule(module)
        const targetSymbol = (symbol: ts.Symbol) =>
          (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol
        return {
          valueNames: new Set(
            exportedSymbols.flatMap((symbol) =>
              (targetSymbol(symbol).flags & ts.SymbolFlags.Value) !== 0 ? [symbol.name] : [],
            ),
          ),
          typeNames: new Set(
            exportedSymbols.flatMap((symbol) =>
              (targetSymbol(symbol).flags & ts.SymbolFlags.Type) !== 0 ? [symbol.name] : [],
            ),
          ),
          callable: new Set(
            exportedSymbols.flatMap((symbol) => {
              const type = checker.getTypeOfSymbolAtLocation(symbol, source)
              return checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0
                ? [symbol.name]
                : []
            }),
          ),
          types: new Map(
            exportedSymbols.map((symbol) => [
              symbol.name,
              checker.typeToString(
                checker.getTypeOfSymbolAtLocation(symbol, source),
                source,
                ts.TypeFormatFlags.NoTruncation,
              ),
            ]),
          ),
        }
      }
      return {
        root: exportsAt(entryPoint, betterNativePackage(expoPackage)),
        expoCompat: exportsAt(
          path.join(repository.root, expoCompatPath(expoPackage)),
          `${betterNativePackage(expoPackage)}/expo`,
        ),
      }
    },
    catch: (cause) =>
      new HarnessError({
        operation: "extract Better Native API with TypeScript",
        path: entryPoint,
        cause,
      }),
  })
})

const mappingKey = (packageName: string, expoExport: string) => `${packageName}#${expoExport}`

export const validateCoverageMappings = Effect.fn("Coverage.validateCoverageMappings")(function* (
  decoded: Schema.Schema.Type<typeof CoverageMappings>,
  expectedExpoRevision: string,
) {
  if (decoded.expoRevision !== expectedExpoRevision) {
    return yield* new HarnessError({
      operation: "validate API coverage mapping",
      path: "compatibility/api-mappings.json",
      cause: `Expo revision ${decoded.expoRevision} does not match pinned revision ${expectedExpoRevision}`,
    })
  }
  const seen = new Set<string>()
  const atomTargets = new Set<string>()
  for (const mapping of decoded.mappings) {
    const key = mappingKey(mapping.package, mapping.expoExport)
    if (seen.has(key)) {
      return yield* new HarnessError({
        operation: "validate API coverage mapping",
        path: "compatibility/api-mappings.json",
        cause: `duplicate mapping ${key}`,
      })
    }
    seen.add(key)
    if (mapping.status === "intentional-divergence" && mapping.reason.trim().length === 0) {
      return yield* new HarnessError({
        operation: "validate API coverage mapping",
        path: "compatibility/api-mappings.json",
        cause: `missing reason for ${key}`,
      })
    }
    if (mapping.status !== "intentional-divergence") {
      if (
        (mapping.deprecated === true &&
          (mapping.deprecationReason === undefined ||
            mapping.deprecationReason.trim().length === 0)) ||
        (mapping.deprecated !== true && mapping.deprecationReason !== undefined)
      ) {
        return yield* new HarnessError({
          operation: "validate API coverage mapping",
          path: "compatibility/api-mappings.json",
          cause: `invalid deprecation metadata for ${key}`,
        })
      }
      if (mapping.atomTarget !== undefined) {
        if (mapping.status !== "expo-compat" || !mapping.expoExport.startsWith("use")) {
          return yield* new HarnessError({
            operation: "validate API coverage mapping",
            path: "compatibility/api-mappings.json",
            cause: `atom target is only valid for an Expo-compatible hook mapping: ${key}`,
          })
        }
        if (atomTargets.has(mapping.atomTarget)) {
          return yield* new HarnessError({
            operation: "validate API coverage mapping",
            path: "compatibility/api-mappings.json",
            cause: `duplicate atom target ${mapping.atomTarget}`,
          })
        }
        atomTargets.add(mapping.atomTarget)
      }
    }
  }
  const seenTypes = new Set<string>()
  for (const mapping of decoded.typeMappings) {
    const key = mappingKey(mapping.package, mapping.expoType)
    if (seenTypes.has(key)) {
      return yield* new HarnessError({
        operation: "validate API type coverage mapping",
        path: "compatibility/api-mappings.json",
        cause: `duplicate type mapping ${key}`,
      })
    }
    seenTypes.add(key)
    if (mapping.status === "intentional-divergence" && mapping.reason.trim().length === 0) {
      return yield* new HarnessError({
        operation: "validate API type coverage mapping",
        path: "compatibility/api-mappings.json",
        cause: `missing reason for type ${key}`,
      })
    }
  }
  return decoded
})

const loadCoverageMappings = Effect.fn("Coverage.loadCoverageMappings")(function* () {
  const repository = yield* ExpoRepository
  const decoded = yield* repository.readJson("compatibility/api-mappings.json", CoverageMappings)
  return yield* validateCoverageMappings(decoded, repository.upstreams.expo.revision)
})

export const validateCoverageTarget = Effect.fn("Coverage.validateCoverageTarget")(function* (
  expoPackage: string,
  expoExport: string,
  mapping: Exclude<CoverageMapping, { readonly status: "intentional-divergence" }>,
  betterNativeExports: { readonly root: TypeScriptExports; readonly expoCompat: TypeScriptExports },
) {
  const key = mappingKey(expoPackage, expoExport)
  const rootPrefix = `${betterNativePackage(expoPackage)}#`
  const compatPrefix = `${betterNativePackage(expoPackage)}/expo#`
  const expectedPrefix = mapping.status === "expo-compat" ? compatPrefix : rootPrefix
  const targetExport = mapping.target.startsWith(expectedPrefix)
    ? mapping.target.slice(expectedPrefix.length)
    : undefined
  const targetExists =
    targetExport === expoExport &&
    (mapping.status === "expo-compat"
      ? betterNativeExports.expoCompat.valueNames.has(targetExport)
      : betterNativeExports.root.valueNames.has(targetExport))
  if (!targetExists) {
    return yield* new HarnessError({
      operation: "validate API coverage target",
      path: "compatibility/api-mappings.json",
      cause: `${key} maps to missing or invalid target ${mapping.target}`,
    })
  }

  if (
    mapping.status === "effect-stream" &&
    targetExport !== undefined &&
    !betterNativeExports.root.types.get(targetExport)?.includes('import("effect/Stream").Stream<')
  ) {
    return yield* new HarnessError({
      operation: "validate API coverage target category",
      path: "compatibility/api-mappings.json",
      cause: `${key} maps to a target that is not an Effect Stream: ${mapping.target}`,
    })
  }

  if (mapping.status === "effect-api" && targetExport !== undefined) {
    const targetType = betterNativeExports.root.types.get(targetExport)
    if (
      (betterNativeExports.root.callable.has(targetExport) &&
        !targetType?.includes('import("effect/Effect").Effect<')) ||
      targetType?.includes('import("effect/Stream").Stream<') ||
      targetType?.includes('import("effect/unstable/reactivity/Atom").Atom<')
    ) {
      return yield* new HarnessError({
        operation: "validate API coverage target category",
        path: "compatibility/api-mappings.json",
        cause: `${key} maps to a target that is not an Effect value API: ${mapping.target}`,
      })
    }
  }

  if (mapping.atomTarget !== undefined) {
    const atomPrefix = `${betterNativePackage(expoPackage)}#`
    const atomExport = mapping.atomTarget.startsWith(atomPrefix)
      ? mapping.atomTarget.slice(atomPrefix.length)
      : undefined
    if (
      atomExport === undefined ||
      !betterNativeExports.root.valueNames.has(atomExport) ||
      !betterNativeExports.root.types
        .get(atomExport)
        ?.includes('import("effect/unstable/reactivity/Atom").Atom<')
    ) {
      return yield* new HarnessError({
        operation: "validate API coverage atom target",
        path: "compatibility/api-mappings.json",
        cause: `${key} maps to missing or invalid atom target ${mapping.atomTarget}`,
      })
    }
  }
})

export const validateCoverageTypeTarget = Effect.fn("Coverage.validateCoverageTypeTarget")(
  function* (
    expoPackage: string,
    expoType: string,
    mapping: Exclude<TypeCoverageMapping, { readonly status: "intentional-divergence" }>,
    betterNativeExports: {
      readonly root: TypeScriptExports
      readonly expoCompat: TypeScriptExports
    },
  ) {
    const key = mappingKey(expoPackage, expoType)
    const rootPrefix = `${betterNativePackage(expoPackage)}#`
    const compatPrefix = `${betterNativePackage(expoPackage)}/expo#`
    const expectedPrefix = mapping.status === "expo-compat-type" ? compatPrefix : rootPrefix
    const targetType = mapping.target.startsWith(expectedPrefix)
      ? mapping.target.slice(expectedPrefix.length)
      : undefined
    const targetExists =
      targetType === expoType &&
      (mapping.status === "expo-compat-type"
        ? betterNativeExports.expoCompat.typeNames.has(targetType)
        : betterNativeExports.root.typeNames.has(targetType))
    if (!targetExists) {
      return yield* new HarnessError({
        operation: "validate API type coverage target",
        path: "compatibility/api-mappings.json",
        cause: `${key} maps to missing or invalid type target ${mapping.target}`,
      })
    }
  },
)

const coverageEntries = Effect.fn("Coverage.coverageEntries")(function* (
  expoPackage: string,
  mappings: ReadonlyMap<string, CoverageMapping>,
  typeMappings: ReadonlyMap<string, TypeCoverageMapping>,
) {
  const [expoExports, betterNativeExports] = yield* Effect.all([
    loadExpoExports(expoPackage),
    loadBetterNativeExports(expoPackage),
  ])
  return {
    entries: yield* Effect.forEach(
      expoExports.values,
      (expoExport): Effect.Effect<CoverageEntry, HarnessError> => {
        const key = mappingKey(expoPackage, expoExport)
        const mapping = mappings.get(key)
        if (mapping === undefined) {
          return Effect.succeed({
            packageName: expoPackage,
            expoExport,
            status: "missing" as const,
            target: null,
          } satisfies CoverageEntry)
        }

        const entry = {
          packageName: expoPackage,
          expoExport,
          status: mapping.status,
          target: mapping.status === "intentional-divergence" ? null : mapping.target,
          ...(mapping.status === "intentional-divergence"
            ? { reason: mapping.reason }
            : {
                ...(mapping.deprecated === true
                  ? {
                      deprecated: true as const,
                      deprecationReason: mapping.deprecationReason!,
                    }
                  : {}),
                ...(mapping.atomTarget === undefined ? {} : { atomTarget: mapping.atomTarget }),
              }),
        } satisfies CoverageEntry
        return mapping.status === "intentional-divergence"
          ? Effect.succeed(entry)
          : validateCoverageTarget(expoPackage, expoExport, mapping, betterNativeExports).pipe(
              Effect.as(entry),
            )
      },
    ),
    typeEntries: yield* Effect.forEach(
      expoExports.types,
      (expoType): Effect.Effect<TypeCoverageEntry, HarnessError> => {
        const mapping = typeMappings.get(mappingKey(expoPackage, expoType))
        if (mapping === undefined) {
          return Effect.succeed({
            packageName: expoPackage,
            expoType,
            status: "missing" as const,
            target: null,
          })
        }
        const entry = {
          packageName: expoPackage,
          expoType,
          status: mapping.status,
          target: mapping.status === "intentional-divergence" ? null : mapping.target,
          ...(mapping.status === "intentional-divergence" ? { reason: mapping.reason } : {}),
        } satisfies TypeCoverageEntry
        return mapping.status === "intentional-divergence"
          ? Effect.succeed(entry)
          : validateCoverageTypeTarget(expoPackage, expoType, mapping, betterNativeExports).pipe(
              Effect.as(entry),
            )
      },
    ),
    effectAtoms: expoExports.values.filter((expoExport) => {
      const mapping = mappings.get(mappingKey(expoPackage, expoExport))
      return mapping?.status !== "intentional-divergence" && mapping?.atomTarget !== undefined
    }).length,
    packageName: expoPackage,
  }
})

const summarizePackage = (
  packageName: string,
  entries: ReadonlyArray<CoverageEntry>,
  typeEntries: ReadonlyArray<TypeCoverageEntry>,
  effectAtoms: number,
): PackageSummary => {
  const count = (status: CoverageStatus) =>
    entries.filter((entry) => entry.status === status).length
  const missing = count("missing")
  const hooks = entries.filter(
    (entry) => entry.status === "expo-compat" && entry.expoExport.startsWith("use"),
  ).length
  const missingTypes = typeEntries.filter(({ status }) => status === "missing").length
  const intentionalDivergences =
    count("intentional-divergence") +
    typeEntries.filter(({ status }) => status === "intentional-divergence").length
  const expoApi = entries.filter(
    (entry) =>
      !entry.expoExport.startsWith("use") &&
      !(entry.expoExport.startsWith("add") && entry.expoExport.endsWith("Listener")),
  ).length
  let status: PackageSummary["status"] = "complete"
  if (missing > 0 || missingTypes > 0) {
    status = "missing"
  } else if (intentionalDivergences > 0) {
    status = "intentional-divergence"
  }
  return {
    packageName,
    expoExports: entries.length,
    deprecatedExpoApis: entries.filter((entry) => entry.deprecated === true).length,
    accountedExports: entries.length - missing,
    expoTypes: typeEntries.length,
    accountedTypes: typeEntries.length - missingTypes,
    effectTypes: typeEntries.filter(({ status: mappingStatus }) => mappingStatus === "effect-type")
      .length,
    expoCompatTypes: typeEntries.filter(
      ({ status: mappingStatus }) => mappingStatus === "expo-compat-type",
    ).length,
    missingTypes,
    expoApi,
    effectApi: count("effect-api"),
    effectStream: count("effect-stream"),
    reactHooks: hooks,
    effectAtoms,
    intentionalDivergences,
    missing,
    status,
  }
}

const summarize = (
  entries: ReadonlyArray<CoverageEntry>,
  typeEntries: ReadonlyArray<TypeCoverageEntry>,
  atomsByPackage: ReadonlyMap<string, number>,
): ReadonlyArray<PackageSummary> => {
  const byPackage = new Map<string, Array<CoverageEntry>>()
  const typesByPackage = new Map<string, Array<TypeCoverageEntry>>()
  for (const entry of entries) {
    byPackage.set(entry.packageName, [...(byPackage.get(entry.packageName) ?? []), entry])
  }
  for (const entry of typeEntries) {
    typesByPackage.set(entry.packageName, [...(typesByPackage.get(entry.packageName) ?? []), entry])
  }
  return [...byPackage]
    .map(([packageName, packageEntries]) =>
      summarizePackage(
        packageName,
        packageEntries,
        typesByPackage.get(packageName) ?? [],
        atomsByPackage.get(packageName) ?? 0,
      ),
    )
    .toSorted((left, right) => left.packageName.localeCompare(right.packageName))
}

const cell = (value: string, width: number) => ` ${value.padEnd(width)} `

const renderGrid = (
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string => {
  const widths = header.map((label, index) =>
    Math.max(label.length, ...rows.map((row) => row[index]?.length ?? 0)),
  )
  const line = (left: string, join: string, right: string) =>
    `${left}${widths.map((width) => "─".repeat(width + 2)).join(join)}${right}`
  const row = (values: ReadonlyArray<string>) =>
    `│${values.map((value, index) => cell(value, widths[index] ?? value.length)).join("│")}│`
  return [
    line("┌", "┬", "┐"),
    row(header),
    line("├", "┼", "┤"),
    ...rows.map(row),
    line("└", "┴", "┘"),
  ].join("\n")
}

const renderTable = (coverage: CoverageReport): string => {
  const summaryRows = coverage.packages.map((summary) => {
    return [
      summary.packageName,
      String(summary.expoExports),
      String(summary.deprecatedExpoApis),
      String(summary.accountedExports),
      String(summary.expoTypes),
      String(summary.accountedTypes),
      String(summary.missingTypes),
      String(summary.expoApi),
      String(summary.effectApi),
      String(summary.effectStream),
      String(summary.reactHooks),
      String(summary.effectAtoms),
      String(summary.intentionalDivergences),
      String(summary.missing),
      summary.status,
    ]
  })
  return [
    "Better Native API coverage",
    "",
    renderGrid(
      [
        "Package",
        "Expo exports",
        "Deprecated APIs",
        "Accounted",
        "Expo types",
        "Covered types",
        "Missing types",
        "Expo API",
        "Effect API",
        "Streams",
        "React hooks",
        "Effect atoms",
        "Divergences",
        "Missing",
        "Status",
      ],
      summaryRows,
    ),
  ].join("\n")
}

const loadCoveragePackages = Effect.fn("Coverage.loadCoveragePackages")(function* () {
  const repository = yield* ExpoRepository
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = path.join(
    repository.root,
    "apps/compatibility-suite/src/generated/Replacements.json",
  )
  const source = yield* fs.readFileString(file).pipe(
    Effect.mapError(
      (cause) =>
        new HarnessError({
          operation: "read generated replacement manifest",
          path: file,
          cause,
        }),
    ),
  )
  const parsed = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      Schema.Struct({
        replacements: Schema.optional(
          Schema.Array(
            Schema.Struct({
              source: Schema.optional(Schema.Unknown),
              target: Schema.optional(Schema.Unknown),
            }),
          ),
        ),
      }),
    ),
  )(source).pipe(
    Effect.mapError(
      (cause) =>
        new HarnessError({
          operation: "decode generated replacement manifest",
          path: file,
          cause,
        }),
    ),
  )
  return (parsed.replacements ?? [])
    .flatMap((replacement) =>
      typeof replacement.source === "string" &&
      typeof replacement.target === "string" &&
      /^@better-native\/[^/]+\/expo$/.test(replacement.target)
        ? [replacement.source]
        : [],
    )
    .toSorted()
})

export const validateNoStaleCoverageMappings = Effect.fn(
  "Coverage.validateNoStaleCoverageMappings",
)(function* (mappingEntries: ReadonlyArray<CoverageMapping>, entryKeys: ReadonlySet<string>) {
  const staleMapping = mappingEntries.find(
    (mapping) => !entryKeys.has(mappingKey(mapping.package, mapping.expoExport)),
  )
  if (staleMapping !== undefined) {
    return yield* new HarnessError({
      operation: "validate API coverage mapping",
      path: "compatibility/api-mappings.json",
      cause: `unknown mapping ${mappingKey(staleMapping.package, staleMapping.expoExport)}`,
    })
  }
})

export const validateNoStaleTypeCoverageMappings = Effect.fn(
  "Coverage.validateNoStaleTypeCoverageMappings",
)(function* (mappingEntries: ReadonlyArray<TypeCoverageMapping>, entryKeys: ReadonlySet<string>) {
  const staleMapping = mappingEntries.find(
    (mapping) => !entryKeys.has(mappingKey(mapping.package, mapping.expoType)),
  )
  if (staleMapping !== undefined) {
    return yield* new HarnessError({
      operation: "validate API type coverage mapping",
      path: "compatibility/api-mappings.json",
      cause: `unknown type mapping ${mappingKey(staleMapping.package, staleMapping.expoType)}`,
    })
  }
})

/**
 * Inspects replacement packages and builds the complete API coverage model.
 *
 * @remarks
 * This is the expensive repository-discovery boundary. Callers that need more
 * than one output format should reuse the returned report with {@link print}.
 */
export const inspect = Effect.fn("Coverage.inspect")(function* () {
  const [packages, mappingConfig] = yield* Effect.all([
    loadCoveragePackages(),
    loadCoverageMappings(),
  ])
  const mappingEntries = mappingConfig.mappings
  const typeMappingEntries = mappingConfig.typeMappings
  const mappings = new Map(
    mappingEntries.map((mapping) => [mappingKey(mapping.package, mapping.expoExport), mapping]),
  )
  const typeMappings = new Map(
    typeMappingEntries.map((mapping) => [mappingKey(mapping.package, mapping.expoType), mapping]),
  )
  const groups = yield* Effect.forEach(
    packages,
    (packageName) => coverageEntries(packageName, mappings, typeMappings),
    { concurrency: 2 },
  )
  const entries = groups.flatMap((group) => group.entries)
  const entryKeys = new Set(entries.map((entry) => mappingKey(entry.packageName, entry.expoExport)))
  yield* validateNoStaleCoverageMappings(mappingEntries, entryKeys)
  const typeEntries = groups.flatMap((group) => group.typeEntries)
  const typeEntryKeys = new Set(
    typeEntries.map((entry) => mappingKey(entry.packageName, entry.expoType)),
  )
  yield* validateNoStaleTypeCoverageMappings(typeMappingEntries, typeEntryKeys)
  const atomsByPackage = new Map(
    groups.map((group) => [group.packageName, group.effectAtoms] as const),
  )
  return {
    schemaVersion: 5,
    packages: summarize(entries, typeEntries, atomsByPackage),
    entries: entries.toSorted((left, right) =>
      `${left.packageName}#${left.expoExport}`.localeCompare(
        `${right.packageName}#${right.expoExport}`,
      ),
    ),
    typeEntries: typeEntries.toSorted((left, right) =>
      `${left.packageName}#${left.expoType}`.localeCompare(
        `${right.packageName}#${right.expoType}`,
      ),
    ),
  } satisfies CoverageReport
})

/** Prints an already-inspected coverage model without rediscovering repository state. */
export const print = Effect.fn("Coverage.print")(function* (
  coverage: CoverageReport,
  options: { readonly json: boolean },
) {
  return yield* Console.log(
    options.json ? JSON.stringify(coverage, null, 2) : renderTable(coverage),
  )
})

/**
 * Prints Effect-native API coverage for configured Expo replacements.
 *
 * @remarks
 * Coverage describes export mapping only. It does not convert bundle success or
 * API presence into behavioral compatibility evidence.
 *
 * @param options - Output-format selection.
 * @returns An Effect that completes after the report is printed.
 * @throws {@link HarnessError} when catalog or generated entrypoints cannot be inspected.
 */
export const report = Effect.fn("Coverage.report")(function* (options: { readonly json: boolean }) {
  const coverage = yield* inspect()
  return yield* print(coverage, options)
})
