import * as Match from "effect/Match"
import ts from "typescript"

/** Result of the syntax-aware public-package capability policy. */
export interface Result {
  readonly passed: boolean
  readonly reasons: ReadonlyArray<string>
}

const deniedIdentifiers = new Set([
  "Bun",
  "Deno",
  "Function",
  "WebAssembly",
  "eval",
  "globalThis",
  "process",
  "require",
])

const isAllowedModule = (specifier: string, publicPackages: ReadonlySet<string>) =>
  publicPackages.has(specifier) || specifier === "effect" || specifier.startsWith("effect/")

const isModuleDeclaration = (node: ts.Node): node is ts.ImportDeclaration | ts.ExportDeclaration =>
  ts.isImportDeclaration(node) || ts.isExportDeclaration(node)

const isDynamicModuleCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require"))

const isImportMeta = (node: ts.Node): node is ts.MetaProperty =>
  ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword

const isDeniedIdentifier = (node: ts.Node): node is ts.Identifier =>
  ts.isIdentifier(node) &&
  deniedIdentifiers.has(node.text) &&
  !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
  !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)

/**
 * Checks candidate syntax through TypeScript's AST instead of regexes, including computed imports,
 * CommonJS loading, process globals, and deep/internal package paths.
 */
export const checkPublicConsumerSet = (
  source: string,
  expectedPublicPackages: ReadonlyArray<string>,
): Result => {
  const file = ts.createSourceFile(
    "candidate.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const reasons = new Set<string>()
  const publicPackages = new Set(expectedPublicPackages)
  const importedPublicPackages = new Set<string>()

  const checkModule = (value: ts.Expression | undefined) => {
    if (value === undefined || !ts.isStringLiteralLike(value)) {
      reasons.add("dynamic-module-specifier")
      return
    }
    if (publicPackages.has(value.text)) importedPublicPackages.add(value.text)
    if (!isAllowedModule(value.text, publicPackages)) reasons.add(`forbidden-module:${value.text}`)
  }

  const visit = (node: ts.Node): void => {
    Match.value(node).pipe(
      Match.when(isModuleDeclaration, (declaration) => checkModule(declaration.moduleSpecifier)),
      Match.when(ts.isImportEqualsDeclaration, () => {
        reasons.add("import-equals")
      }),
      Match.when(isDynamicModuleCall, () => {
        reasons.add("dynamic-module-loading")
      }),
      Match.when(isImportMeta, () => {
        reasons.add("import-meta")
      }),
      Match.when(isDeniedIdentifier, (identifier) => {
        reasons.add(`forbidden-capability:${identifier.text}`)
      }),
      Match.orElse(() => undefined),
    )
    ts.forEachChild(node, visit)
  }
  visit(file)
  for (const publicPackage of expectedPublicPackages) {
    if (!importedPublicPackages.has(publicPackage)) {
      reasons.add(`missing-public-package-import:${publicPackage}`)
    }
  }
  return { passed: reasons.size === 0, reasons: [...reasons].toSorted() }
}

/** Checks a consumer that is expected to import one public capability package. */
export const checkPublicConsumer = (source: string, publicPackage: string): Result =>
  checkPublicConsumerSet(source, [publicPackage])
