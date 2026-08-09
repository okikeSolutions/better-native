import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import ts from "typescript"
import { ExpoRepository } from "../ExpoRepository.ts"
import { HarnessError } from "../HarnessError.ts"

type ExportKind = "type" | "value" | "both"
type TypeParameters = { readonly declaration: string; readonly application: string }
type ExportInfo = { readonly kind: ExportKind; readonly typeParameters?: TypeParameters }

// Re-exports from external packages cannot be resolved through Expo's local source graph. Keep
// the small reviewed exceptions here so generated bridges retain the declaration shape exposed by
// the installed public package instead of emitting an invalid non-generic or value-as-type alias.
const externalTypeOverrides: Readonly<Record<string, Readonly<Record<string, TypeParameters>>>> = {
  "expo-location": {
    PermissionHookOptions: {
      declaration: "<Options extends object>",
      application: "<Options>",
    },
  },
}

const valueTypeOverrides = new Set(["expo-location#EventEmitter"])

const mergeExportKind = (left: ExportKind | undefined, right: ExportKind): ExportKind =>
  Match.value(left).pipe(
    Match.when(undefined, () => right),
    Match.when(
      (kind) => kind === right,
      () => right,
    ),
    Match.orElse(() => "both" as const),
  )

const addExport = (name: string, kind: ExportKind, values: Set<string>, types: Set<string>): void =>
  Match.value(kind).pipe(
    Match.when("value", () => void values.add(name)),
    Match.when("type", () => void types.add(name)),
    Match.when("both", () => {
      values.add(name)
      types.add(name)
    }),
    Match.exhaustive,
  )

const typeParametersOf = (
  source: ts.SourceFile,
  nodes: ts.NodeArray<ts.TypeParameterDeclaration> | undefined,
): TypeParameters | undefined => {
  if (nodes === undefined || nodes.length === 0) return undefined
  return {
    declaration: `<${nodes.map((node) => node.getText(source)).join(", ")}>`,
    application: `<${nodes.map((node) => node.name.text).join(", ")}>`,
  }
}

const exportedDeclarations = (sourceText: string): Map<string, ExportInfo> => {
  const source = ts.createSourceFile("module.ts", sourceText, ts.ScriptTarget.Latest, true)
  const exports = new Map<string, ExportInfo>()
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    const isExported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    if (!isExported) continue
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      const name = statement.name.text
      const kind: ExportKind = Match.value(statement).pipe(
        Match.when(ts.isEnumDeclaration, () => "both" as const),
        Match.orElse(() => "value" as const),
      )
      const typeParameters = ts.isEnumDeclaration(statement)
        ? undefined
        : typeParametersOf(source, statement.typeParameters)
      exports.set(name, {
        kind: mergeExportKind(exports.get(name)?.kind, kind),
        ...(typeParameters === undefined ? {} : { typeParameters }),
      })
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.set(declaration.name.text, {
            kind: mergeExportKind(exports.get(declaration.name.text)?.kind, "value"),
          })
        }
      }
    } else if (
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      const name = statement.name.text
      const typeParameters = typeParametersOf(source, statement.typeParameters)
      exports.set(name, {
        kind: mergeExportKind(exports.get(name)?.kind, "type"),
        ...(typeParameters === undefined ? {} : { typeParameters }),
      })
    }
  }
  return exports
}

const relativeModulePath = (specifier: string): string | null =>
  Match.value(specifier).pipe(
    Match.when(
      (modulePath) => modulePath.startsWith("./") || modulePath.startsWith("../"),
      (modulePath) => modulePath,
    ),
    Match.orElse(() => null),
  )

/** Export names discovered from an Expo entrypoint and its wildcard re-export graph. */
export interface CollectedExports {
  readonly values: ReadonlyArray<string>
  readonly types: ReadonlyArray<string>
  readonly typeParameters: ReadonlyMap<string, TypeParameters>
}

/**
 * Collects runtime and type exports without executing an Expo module.
 *
 * The visited set makes wildcard cycles safe. Named re-exports preserve aliases and explicit
 * `type` modifiers, while wildcard targets are traversed recursively.
 */
export const collectExports = <E, R>(
  entry: string,
  readSource: (file: string) => Effect.Effect<string, E, R>,
  resolveSource: (sourceFile: string, specifier: string) => string,
): Effect.Effect<CollectedExports, E, R> =>
  Effect.gen(function* () {
    const values = new Set<string>()
    const types = new Set<string>()
    const typeParameters = new Map<string, TypeParameters>()
    const pending = [entry]
    const visited = new Set<string>()
    while (pending.length > 0) {
      const current = pending.shift()
      if (current === undefined || visited.has(current)) continue
      visited.add(current)

      const sourceText = yield* readSource(current)
      const local = exportedDeclarations(sourceText)
      const source = ts.createSourceFile(current, sourceText, ts.ScriptTarget.Latest, true)
      for (const [name, info] of local) {
        addExport(name, info.kind, values, types)
        if (info.typeParameters !== undefined) typeParameters.set(name, info.typeParameters)
      }
      for (const statement of source.statements) {
        if (!ts.isExportDeclaration(statement)) continue
        const moduleSpecifier = statement.moduleSpecifier
        const relative = Match.value(moduleSpecifier?.kind).pipe(
          Match.when(ts.SyntaxKind.StringLiteral, () =>
            relativeModulePath((moduleSpecifier as ts.StringLiteral).text),
          ),
          Match.orElse(() => null),
        )
        const target = Match.value(relative).pipe(
          Match.when(null, () => null),
          Match.orElse((specifier) => resolveSource(current, specifier)),
        )
        if (statement.exportClause === undefined) {
          if (target !== null) pending.push(target)
          continue
        }
        if (!ts.isNamedExports(statement.exportClause)) continue
        const targetKindsEffect: Effect.Effect<Map<string, ExportInfo>, E, R> = Match.value(
          target,
        ).pipe(
          Match.when(null, () => Effect.succeed(new Map<string, ExportInfo>())),
          Match.orElse((file) => Effect.map(readSource(file), exportedDeclarations)),
        )
        const targetKinds = yield* targetKindsEffect
        for (const element of statement.exportClause.elements) {
          const exported = element.name.text
          const imported = element.propertyName?.text ?? exported
          const targetInfo = targetKinds.get(imported)
          const kind = Match.value(statement.isTypeOnly || element.isTypeOnly).pipe(
            Match.when(true, () => "type" as const),
            Match.when(false, () => targetInfo?.kind ?? "both"),
            Match.exhaustive,
          )
          addExport(exported, kind, values, types)
          if (targetInfo?.typeParameters !== undefined) {
            typeParameters.set(exported, targetInfo.typeParameters)
          }
        }
      }
    }
    return { values: [...values].toSorted(), types: [...types].toSorted(), typeParameters }
  })

const resolveSourceModule = (
  path: Path.Path,
  expoFiles: ReadonlySet<string>,
  sourceFile: string,
  specifier: string,
): string => {
  const stem = path.normalize(path.join(path.dirname(sourceFile), specifier))
  const candidates = [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`]
  return candidates.find((candidate) => expoFiles.has(candidate)) ?? candidates[0]!
}

const mainSourceFile = (expoPackage: string, manifest: unknown): string | null => {
  const main = Match.value(manifest).pipe(
    Match.when(Match.record, (record) => record.main),
    Match.orElse(() => undefined),
  )
  return Match.value(main).pipe(
    Match.when(Match.string, (entrypoint) =>
      Match.value(entrypoint.match(/^build\/(.+)\.js$/)?.[1]).pipe(
        Match.when(Match.string, (stem) => `packages/${expoPackage}/src/${stem}.ts`),
        Match.orElse(() => null),
      ),
    ),
    Match.orElse(() => null),
  )
}

const failure = (operation: string, path: string, cause: unknown): HarnessError =>
  new HarnessError({ operation, path, cause })

const source = Effect.fn("ExpoCompatEntrypoint.source")(function* (expoPackage: string) {
  const repository = yield* ExpoRepository
  const path = yield* Path.Path
  const manifest = yield* repository.readExpoJson(
    `packages/${expoPackage}/package.json`,
    Schema.Unknown,
  )
  const entry = mainSourceFile(expoPackage, manifest)
  const sourceEntry = yield* Match.value(entry).pipe(
    Match.when(Match.string, (value) => Effect.succeed(value)),
    Match.when(null, () =>
      Effect.fail(
        failure(
          "generate Expo-compatible entrypoint",
          `packages/${expoPackage}/package.json`,
          "expected main to point at build/<entry>.js",
        ),
      ),
    ),
    Match.exhaustive,
  )
  const textByFile = new Map<string, string>()
  const expoFiles = new Set(yield* repository.expoFiles)
  const readSource = Effect.fn("ExpoCompatEntrypoint.readSource")(function* (file: string) {
    const cached = textByFile.get(file)
    if (cached !== undefined) return cached
    const text = yield* repository.readExpoText(file)
    textByFile.set(file, text)
    return text
  })
  const { values, types, typeParameters } = yield* collectExports(
    sourceEntry,
    readSource,
    (sourceFile, specifier) => resolveSourceModule(path, expoFiles, sourceFile, specifier),
  )
  const namespace = expoPackage
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")
  const renderValue = (name: string) => {
    const line = `export const ${name}: typeof ${namespace}.${name} = ${namespace}.${name}`
    return line.length > 100
      ? `export const ${name}: typeof ${namespace}.${name} =\n  ${namespace}.${name}`
      : line
  }
  return [
    "// @generated by better-native compatibility harness",
    "// Do not edit manually.",
    `// Source: ${expoPackage} at Expo ${repository.upstreams.expo.revision}`,
    ...(values.some((name) => name.startsWith("_"))
      ? ["/* oxlint-disable no-underscore-dangle -- exact Expo compatibility exports */"]
      : []),
    "",
    `import * as ${namespace} from "${expoPackage}"`,
    "",
    ...values.map(renderValue),
    ...Match.value(values.length > 0 && types.length > 0).pipe(
      Match.when(true, () => [""]),
      Match.when(false, () => []),
      Match.exhaustive,
    ),
    ...types.map((name) => {
      const parameters = typeParameters.get(name) ?? externalTypeOverrides[expoPackage]?.[name]
      const reference = valueTypeOverrides.has(`${expoPackage}#${name}`)
        ? `typeof ${namespace}.${name}`
        : `${namespace}.${name}${parameters?.application ?? ""}`
      const line = `export type ${name}${parameters?.declaration ?? ""} = ${reference}`
      return line.length > 100
        ? `export type ${name}${parameters?.declaration ?? ""} =\n  ${reference}`
        : line
    }),
    "",
  ].join("\n")
})

/** Generated Expo-compatible entrypoint targets derived from replacement mappings. */
export const targets = (
  replacements: ReadonlyArray<{ readonly source: string; readonly target: string }>,
): ReadonlyArray<{ readonly source: string; readonly path: string }> =>
  replacements.flatMap(({ source: expoPackage, target }) => {
    return Match.value(target.match(/^@better-native\/([^/]+)\/expo$/)?.[1]).pipe(
      Match.when(Match.string, (packageDirectory) => [
        { source: expoPackage, path: `packages/${packageDirectory}/src/Expo.ts` },
      ]),
      Match.orElse(() => []),
    )
  })

/** Writes every generated Expo-compatible entrypoint authorized by replacement mappings. */
export const write = Effect.fn("ExpoCompatEntrypoint.write")(function* (
  replacements: ReadonlyArray<{ readonly source: string; readonly target: string }>,
) {
  const repository = yield* ExpoRepository
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  for (const target of targets(replacements)) {
    const output = path.join(repository.root, target.path)
    const contents = yield* source(target.source)
    yield* fs
      .writeFileString(output, contents)
      .pipe(
        Effect.mapError((cause) =>
          failure("write generated Expo-compatible entrypoint", output, cause),
        ),
      )
  }
})
