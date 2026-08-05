import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import {
  Application,
  LogLevel,
  normalizePath,
  TSConfigReader,
  TypeDocReader,
  type JSONOutput,
} from "typedoc"
import { ExpoRepository } from "./ExpoRepository.ts"
import { HarnessError } from "./HarnessError.ts"

type CoverageStatus =
  | "effect-api"
  | "effect-stream"
  | "expo-compat"
  | "react-hook-pending"
  | "missing"

type CoverageEntry = {
  readonly packageName: string
  readonly expoExport: string
  readonly status: CoverageStatus
  readonly target: string | null
}

type PackageSummary = {
  readonly packageName: string
  readonly expoExports: number
  readonly expoApi: number
  readonly effectApi: number
  readonly effectStream: number
  readonly reactHooks: number
  readonly effectAtoms: number
  readonly reactHookPending: number
  readonly missing: number
  readonly status: "complete" | "partial" | "missing"
}

type CoverageReport = {
  readonly schemaVersion: 1
  readonly packages: ReadonlyArray<PackageSummary>
  readonly entries: ReadonlyArray<CoverageEntry>
}

const packageStem = (expoPackage: string): string => expoPackage.replace(/^expo-/, "")

const betterNativePackage = (expoPackage: string): string =>
  `@better-native/${packageStem(expoPackage)}`

const expoCompatPath = (expoPackage: string): string =>
  `packages/${packageStem(expoPackage)}/src/Expo.ts`

const entrypointPath = (expoPackage: string): string =>
  `packages/${packageStem(expoPackage)}/src/index.ts`

const tsconfigPath = (expoPackage: string): string =>
  `packages/${packageStem(expoPackage)}/tsconfig.json`

const expoValueExports = (source: string): ReadonlyArray<string> =>
  [...source.matchAll(/^export const ([A-Za-z_$][\w$]*) = /gm)].map((match) => match[1]!).toSorted()

const lowerFirst = (value: string): string =>
  value.length === 0 ? value : `${value[0]!.toLowerCase()}${value.slice(1)}`

const stripPackageToken = (value: string, expoPackage: string): string => {
  const token = packageStem(expoPackage)
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")
  return value.startsWith(token) ? value.slice(token.length) : value
}

const asyncCandidates = (expoPackage: string, expoExport: string): ReadonlyArray<string> => {
  const withoutAsync = expoExport.replace(/Async$/, "")
  if (withoutAsync.startsWith("get")) {
    const stem = withoutAsync.slice("get".length)
    return [withoutAsync, `get${stripPackageToken(stem, expoPackage)}`]
  }
  return [withoutAsync]
}

const listenerCandidates = (expoPackage: string, expoExport: string): ReadonlyArray<string> => {
  const eventStem = stripPackageToken(
    expoExport.replace(/^add/, "").replace(/Listener$/, ""),
    expoPackage,
  )
  return [`${lowerFirst(eventStem)}Changes`]
}

const exactCandidate = (expoExport: string): ReadonlyArray<string> => [expoExport]

const candidates = (expoPackage: string, expoExport: string): ReadonlyArray<string> =>
  Match.value(expoExport).pipe(
    Match.when(
      (name) => name.startsWith("use"),
      () => exactCandidate(expoExport),
    ),
    Match.when(
      (name) => name.startsWith("add") && name.endsWith("Listener"),
      () => listenerCandidates(expoPackage, expoExport),
    ),
    Match.when(
      (name) => name.endsWith("Async"),
      () => asyncCandidates(expoPackage, expoExport),
    ),
    Match.orElse(() => exactCandidate(expoExport)),
  )

const statusFor = (expoExport: string, target: string | null): CoverageStatus =>
  Match.value(expoExport).pipe(
    Match.when(
      (name) => name.startsWith("use") && target === null,
      () => "react-hook-pending" as const,
    ),
    Match.when(
      (name) => name.startsWith("use"),
      () => "expo-compat" as const,
    ),
    Match.when(
      () => target === null,
      () => "missing" as const,
    ),
    Match.when(
      (name) => name.startsWith("add") && name.endsWith("Listener"),
      () => "effect-stream" as const,
    ),
    Match.orElse(() => "effect-api" as const),
  )

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
  return expoValueExports(source)
})

const typedocChildren = (
  json: JSONOutput.ProjectReflection,
): ReadonlyArray<JSONOutput.DeclarationReflection> => json.children ?? []

const loadBetterNativeExports = Effect.fn("Coverage.loadBetterNativeExports")(function* (
  expoPackage: string,
) {
  const repository = yield* ExpoRepository
  const path = yield* Path.Path
  const entryPoint = path.join(repository.root, entrypointPath(expoPackage))
  const tsconfig = path.join(repository.root, tsconfigPath(expoPackage))
  const artifact = path.join(
    repository.root,
    ".artifacts/compatibility",
    `typedoc-${packageStem(expoPackage)}.json`,
  )
  return yield* Effect.tryPromise({
    try: async () => {
      const app = await Application.bootstrapWithPlugins(
        {
          entryPoints: [entryPoint],
          tsconfig,
          disableSources: true,
          hideGenerator: true,
          excludePrivate: true,
          excludeProtected: true,
          excludeExternals: true,
          pretty: true,
          commentStyle: "block",
          jsDocCompatibility: false,
          preserveLinkText: true,
          sourceLinkExternal: false,
          markdownLinkExternal: false,
          logLevel: LogLevel.None,
        },
        [new TSConfigReader(), new TypeDocReader()],
      )
      const project = await app.convert()
      if (project === undefined)
        throw new Error(`TypeDoc failed for ${betterNativePackage(expoPackage)}`)
      await app.generateJson(project, artifact)
      const json = app.serializer.projectToObject(project, normalizePath(repository.root))
      return new Set(typedocChildren(json).map((child) => child.name))
    },
    catch: (cause) =>
      new HarnessError({
        operation: "extract Better Native API with TypeDoc",
        path: entryPoint,
        cause,
      }),
  })
})

const coverageEntries = Effect.fn("Coverage.coverageEntries")(function* (expoPackage: string) {
  const [expoExports, betterNativeExports] = yield* Effect.all([
    loadExpoExports(expoPackage),
    loadBetterNativeExports(expoPackage),
  ])
  return {
    entries: expoExports.map((expoExport) => {
      const targetExport = candidates(expoPackage, expoExport).find((candidate) =>
        betterNativeExports.has(candidate),
      )
      let target: string | null = null
      if (expoExport.startsWith("use")) {
        target = `${betterNativePackage(expoPackage)}/expo#${expoExport}`
      } else if (targetExport !== undefined) {
        target = `${betterNativePackage(expoPackage)}#${targetExport}`
      }
      return {
        packageName: expoPackage,
        expoExport,
        status: statusFor(expoExport, target),
        target,
      } satisfies CoverageEntry
    }),
    effectAtoms: [...betterNativeExports].filter((exportName) => exportName.endsWith("Atom"))
      .length,
    packageName: expoPackage,
  }
})

const summarizePackage = (
  packageName: string,
  entries: ReadonlyArray<CoverageEntry>,
  effectAtoms: number,
): PackageSummary => {
  const count = (status: CoverageStatus) =>
    entries.filter((entry) => entry.status === status).length
  const missing = count("missing")
  const hooks = count("expo-compat")
  const pending = count("react-hook-pending")
  const expoApi = entries.filter(
    (entry) =>
      !entry.expoExport.startsWith("use") &&
      !(entry.expoExport.startsWith("add") && entry.expoExport.endsWith("Listener")),
  ).length
  const status = Match.value({ hasMissing: missing > 0, hasPending: pending > 0 }).pipe(
    Match.when({ hasMissing: true }, () => "missing" as const),
    Match.when({ hasPending: true }, () => "partial" as const),
    Match.orElse(() => "complete" as const),
  )
  return {
    packageName,
    expoExports: entries.length,
    expoApi,
    effectApi: count("effect-api"),
    effectStream: count("effect-stream"),
    reactHooks: hooks,
    effectAtoms,
    reactHookPending: pending,
    missing,
    status,
  }
}

const summarize = (
  entries: ReadonlyArray<CoverageEntry>,
  atomsByPackage: ReadonlyMap<string, number>,
): ReadonlyArray<PackageSummary> => {
  const byPackage = new Map<string, Array<CoverageEntry>>()
  for (const entry of entries) {
    byPackage.set(entry.packageName, [...(byPackage.get(entry.packageName) ?? []), entry])
  }
  return [...byPackage]
    .map(([packageName, packageEntries]) =>
      summarizePackage(packageName, packageEntries, atomsByPackage.get(packageName) ?? 0),
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
    const betterNativeExports = summary.effectApi + summary.effectStream + summary.reactHooks
    return [
      summary.packageName,
      String(summary.expoExports),
      String(betterNativeExports),
      String(summary.expoApi),
      String(summary.effectApi),
      String(summary.effectStream),
      `${summary.reactHooks}/${summary.reactHooks + summary.reactHookPending}`,
      String(summary.effectAtoms),
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
        "Covered exports",
        "Expo API",
        "Effect API",
        "Streams",
        "React hooks",
        "Effect atoms",
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
  const parsed = Schema.decodeUnknownSync(
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
  )(source)
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

const makeReport = Effect.fn("Coverage.makeReport")(function* () {
  const packages = yield* loadCoveragePackages()
  const groups = yield* Effect.forEach(packages, coverageEntries, { concurrency: 2 })
  const entries = groups.flatMap((group) => group.entries)
  const atomsByPackage = new Map(
    groups.map((group) => [group.packageName, group.effectAtoms] as const),
  )
  return {
    schemaVersion: 1,
    packages: summarize(entries, atomsByPackage),
    entries: entries.toSorted((left, right) =>
      `${left.packageName}#${left.expoExport}`.localeCompare(
        `${right.packageName}#${right.expoExport}`,
      ),
    ),
  } satisfies CoverageReport
})

export const report = Effect.fn("Coverage.report")(function* (options: { readonly json: boolean }) {
  const coverage = yield* makeReport()
  return yield* Console.log(
    options.json ? JSON.stringify(coverage, null, 2) : renderTable(coverage),
  )
})
