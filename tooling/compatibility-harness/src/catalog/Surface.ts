import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as ts from "typescript"
import {
  ExportName,
  SurfaceId,
  type CatalogSnapshot,
  type ExpoInstallation,
  type ExportKind,
  type SurfaceExport,
  type SurfaceSnapshot,
} from "../Domain.ts"
import { ExpoRepository } from "../ExpoRepository.ts"
import { HarnessError } from "../HarnessError.ts"

const codeFile = /(?:\.[cm]?[jt]sx?|\.d\.[cm]?ts)$/

const withoutDotSlash = (value: string): string => (value.startsWith("./") ? value.slice(2) : value)

const mergeKind = (left: ExportKind | undefined, right: ExportKind): ExportKind => {
  if (left === undefined || left === right) return right
  if (left === "default" || right === "default") return "default"
  if (left === "opaque-module" || right === "opaque-module") return "opaque-module"
  return "value-and-type"
}

const declarationKind = (node: ts.Node): ExportKind => {
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return "type"
  if (ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) return "value-and-type"
  return "value"
}

const bindingNames = (name: ts.BindingName): ReadonlyArray<string> => {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  )
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) &&
  ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true

export const moduleCandidates = (
  path: Path.Path,
  currentFile: string,
  specifier: string,
): ReadonlyArray<string> => {
  if (!specifier.startsWith(".")) return []
  const base = path.normalize(path.join(path.dirname(currentFile), specifier)).replaceAll("\\", "/")
  const declarationBase = base.replace(/\.[cm]?js$/, "")
  const declarations = /\.d\.[cm]?ts$/.test(currentFile)
    ? [
        `${declarationBase}.d.ts`,
        `${declarationBase}.d.mts`,
        `${declarationBase}.d.cts`,
        `${declarationBase}/index.d.ts`,
        `${declarationBase}/index.d.mts`,
        `${declarationBase}/index.d.cts`,
      ]
    : []
  return [
    ...declarations,
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.d.ts`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.d.ts`,
  ]
}

const moduleTarget = (
  path: Path.Path,
  currentFile: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | undefined => {
  for (const candidate of moduleCandidates(path, currentFile, specifier)) {
    if (files.has(candidate)) return candidate
  }
  return undefined
}

export const exportsOf = (
  path: Path.Path,
  entryFiles: ReadonlyArray<string>,
  sources: ReadonlyMap<string, string>,
): ReadonlyMap<string, { readonly kind: ExportKind; readonly paths: ReadonlySet<string> }> => {
  const output = new Map<string, { kind: ExportKind; paths: Set<string> }>()
  const visited = new Set<string>()
  const available = new Set(sources.keys())
  const add = (name: string, kind: ExportKind, file: string) => {
    const current = output.get(name)
    output.set(name, {
      kind: mergeKind(current?.kind, kind),
      paths: new Set([...(current?.paths ?? []), file]),
    })
  }
  const kindOfExport = (
    file: string,
    exportName: string,
    seen = new Set<string>(),
  ): ExportKind | undefined => {
    const key = `${file}#${exportName}`
    if (seen.has(key)) return undefined
    seen.add(key)
    const text = sources.get(file)
    if (text === undefined) return undefined
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    for (const statement of source.statements) {
      if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name?.text === exportName
      ) {
        return declarationKind(statement)
      }
      if (ts.isVariableStatement(statement)) {
        const names = statement.declarationList.declarations.flatMap((declaration) =>
          bindingNames(declaration.name),
        )
        if (names.includes(exportName)) return "value"
      }
      if (!ts.isExportDeclaration(statement)) continue
      const target =
        statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)
          ? moduleTarget(path, file, statement.moduleSpecifier.text, available)
          : undefined
      if (statement.exportClause === undefined) {
        if (target !== undefined) {
          const kind = kindOfExport(target, exportName, seen)
          if (kind !== undefined) return kind
        }
        continue
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        if (statement.exportClause.name.text === exportName) return "value"
        continue
      }
      const element = statement.exportClause.elements.find(({ name }) => name.text === exportName)
      if (element === undefined) continue
      if (statement.isTypeOnly || element.isTypeOnly) return "type"
      if (target === undefined) return "value-and-type"
      return kindOfExport(target, element.propertyName?.text ?? element.name.text, seen)
    }
    return undefined
  }
  const visit = (file: string) => {
    if (visited.has(file)) return
    visited.add(file)
    const text = sources.get(file)
    if (text === undefined) return
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    for (const statement of source.statements) {
      if (ts.isExportAssignment(statement)) {
        add("default", "default", file)
        continue
      }
      if (ts.isExportDeclaration(statement)) {
        if (statement.exportClause !== undefined) {
          if (ts.isNamespaceExport(statement.exportClause)) {
            add(statement.exportClause.name.text, "value", file)
          } else {
            for (const element of statement.exportClause.elements) {
              const target =
                statement.moduleSpecifier !== undefined &&
                ts.isStringLiteral(statement.moduleSpecifier)
                  ? moduleTarget(path, file, statement.moduleSpecifier.text, available)
                  : undefined
              let kind: ExportKind = "value-and-type"
              if (statement.isTypeOnly || element.isTypeOnly) kind = "type"
              else if (target !== undefined) {
                kind =
                  kindOfExport(target, element.propertyName?.text ?? element.name.text) ??
                  "value-and-type"
              }
              add(element.name.text, kind, file)
            }
          }
        } else if (
          statement.moduleSpecifier !== undefined &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          const target = moduleTarget(path, file, statement.moduleSpecifier.text, available)
          if (target !== undefined) visit(target)
        }
        continue
      }
      if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        add("default", "default", file)
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          for (const name of bindingNames(declaration.name)) add(name, "value", file)
        }
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name !== undefined
      ) {
        add(statement.name.text, declarationKind(statement), file)
      }
    }
  }
  for (const file of entryFiles) visit(file)
  return output
}

const surfaceId = (packageName: string, subpath: string, name: string) =>
  SurfaceId.make(`${packageName}#${subpath}#${name}`)

/**
 * Derives the complete export surface from catalog and installation evidence.
 *
 * @remarks
 * Surface generation preserves type-only, opaque, wildcard, and platform-aware
 * exports so compatibility ownership cannot silently shrink to runtime values.
 *
 * @param snapshot - Pinned package catalog snapshot.
 * @param installation - Prepared installation and expanded entrypoint evidence.
 * @returns The versioned surface snapshot and fingerprint.
 * @throws {@link HarnessError} when declarations cannot be read or parsed.
 */
export const make = Effect.fn("Surface.make")(function* (
  snapshot: CatalogSnapshot,
  installation: ExpoInstallation,
) {
  const repository = yield* ExpoRepository
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const catalog = new Map(snapshot.catalog.packages.map((entry) => [entry.name as string, entry]))
  const exports: Array<SurfaceExport> = []

  for (const installed of installation.packages) {
    const packageEntry = catalog.get(installed.name)
    if (packageEntry === undefined || installed.targetPackagePath === null) continue
    const targetPackagePath = installed.targetPackagePath
    const sourceFiles = installed.targetFiles.filter((file) => codeFile.test(file))
    const sources = new Map<string, string>()
    yield* Effect.forEach(
      sourceFiles,
      (file) =>
        fs.readFileString(path.join(repository.root, targetPackagePath, file)).pipe(
          Effect.tap((text) => Effect.sync(() => sources.set(file, text))),
          Effect.mapError(
            (cause) =>
              new HarnessError({
                operation: "read declaration source",
                path: path.join(targetPackagePath, file),
                cause,
              }),
          ),
        ),
      { concurrency: 16, discard: true },
    )

    for (const entrypoint of installed.targetEntrypoints) {
      const concrete = entrypoint.pattern
        ? installed.expandedEntrypoints
            .filter((entry) => entry.declaredSubpath === entrypoint.subpath)
            .map((entry) => ({ subpath: entry.subpath, files: entry.matchedFiles }))
        : [
            {
              subpath: entrypoint.subpath,
              files: entrypoint.resolutionBranches.flatMap((branch) => {
                if (branch.target === null || branch.target.includes("*")) return []
                const target = withoutDotSlash(branch.target)
                return installed.targetFiles.includes(target) ? [target] : []
              }),
            },
          ]
      const platforms = [
        ...new Set(entrypoint.resolutionBranches.flatMap((branch) => branch.platforms)),
      ].toSorted()
      for (const item of concrete) {
        const declarations = item.files.filter((file) => codeFile.test(file))
        const named = exportsOf(path, declarations, sources)
        if (named.size === 0) {
          exports.push({
            id: surfaceId(installed.name, item.subpath, "$module"),
            package: installed.name,
            subpath: item.subpath,
            name: ExportName.make("$module"),
            kind: "opaque-module",
            platforms,
            declarationPaths: declarations.toSorted(),
          })
          continue
        }
        for (const [name, value] of named) {
          exports.push({
            id: surfaceId(installed.name, item.subpath, name),
            package: installed.name,
            subpath: item.subpath,
            name: ExportName.make(name),
            kind: value.kind,
            platforms,
            declarationPaths: [...value.paths].toSorted(),
          })
        }
      }
    }
  }

  const sorted = exports.toSorted((left, right) => left.id.localeCompare(right.id))
  const fingerprint = yield* repository.hashString(JSON.stringify(sorted))
  return {
    schemaVersion: 1,
    expoRevision: snapshot.catalog.expoRevision,
    catalogFingerprint: snapshot.fingerprint,
    fingerprint,
    exports: sorted,
  } satisfies SurfaceSnapshot
})
