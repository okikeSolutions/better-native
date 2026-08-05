import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as RegExp from "effect/RegExp"
import * as ts from "typescript"
import {
  Suites,
  TestCaseId,
  TestSourceId,
  type CorpusSnapshot,
  type TestCase,
  type TestSource,
  type TestSourceId as TestSourceIdType,
} from "../Domain.ts"
import { ExpoRepository } from "../ExpoRepository.ts"
import { HarnessError } from "../HarnessError.ts"

const stringArgument = (node: ts.Expression | undefined): string | undefined => {
  if (node === undefined) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}

const testFunctions = new Set(["it", "test", "fit", "xit"])
const suiteFunctions = new Set(["describe", "fdescribe", "xdescribe"])

const baseCallName = (
  expression: ts.Expression,
  toolObjects: ReadonlySet<string> = new Set(),
): string | undefined => {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return toolObjects.has(expression.expression.text)
      ? expression.name.text
      : expression.expression.text
  }
  return undefined
}

const containsTestCall = (node: ts.Node, toolObjects: ReadonlySet<string>): boolean => {
  let found = false
  const visit = (child: ts.Node) => {
    if (found) return
    if (
      ts.isCallExpression(child) &&
      testFunctions.has(baseCallName(child.expression, toolObjects) ?? "")
    ) {
      found = true
      return
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

/**
 * Statically analyzes one test source for case declarations.
 *
 * @remarks
 * Literal case names are retained as static evidence. Parameterized tests,
 * wrappers, RuleTester calls, and dynamic titles mark the source for runtime
 * discovery rather than inventing case identifiers.
 *
 * @param sourceId - Stable source identifier.
 * @param file - Source path used by the TypeScript parser.
 * @param text - Source text to analyze.
 * @param invokedFactoryName - Optional exported factory whose parameters act as test tools.
 * @returns Statically discovered cases and the strongest available evidence kind.
 */
export const analyzeCases = (
  sourceId: TestSourceIdType,
  file: string,
  text: string,
  invokedFactoryName?: string,
) => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const cases: Array<TestCase> = []
  const occurrences = new Map<string, number>()
  const wrappers = new Set<string>()
  const toolObjects = new Set<string>()
  let dynamic = false

  const factory = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === invokedFactoryName,
  )
  for (const parameter of factory?.parameters ?? []) {
    if (ts.isIdentifier(parameter.name)) toolObjects.add(parameter.name.text)
  }

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined && statement.body) {
      if (containsTestCall(statement.body, toolObjects)) wrappers.add(statement.name.text)
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer !== undefined &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer)) &&
          containsTestCall(declaration.initializer.body, toolObjects)
        ) {
          wrappers.add(declaration.name.text)
        }
      }
    }
  }

  const addCase = (parents: ReadonlyArray<string>, title: string) => {
    const fullName = [...parents, title].join(" > ")
    const occurrence = (occurrences.get(fullName) ?? 0) + 1
    occurrences.set(fullName, occurrence)
    cases.push({
      id: TestCaseId.make(`${sourceId}#${fullName}@${occurrence}`),
      sourceId,
      name: fullName,
      discovery: "static",
    })
  }

  const visit = (node: ts.Node, parents: ReadonlyArray<string>) => {
    if (ts.isCallExpression(node)) {
      const name = baseCallName(node.expression, toolObjects)
      const title = stringArgument(node.arguments[0])
      if (suiteFunctions.has(name ?? "")) {
        const callback = node.arguments[1]
        if (title === undefined) dynamic = true
        if (
          callback !== undefined &&
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        ) {
          ts.forEachChild(callback.body, (child) =>
            visit(child, title === undefined ? parents : [...parents, title]),
          )
        }
        return
      }
      if (testFunctions.has(name ?? "")) {
        if (title === undefined) dynamic = true
        else addCase(parents, title)
        return
      }
      if (
        ts.isCallExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === "each" &&
        (testFunctions.has(
          baseCallName(node.expression.expression.expression, toolObjects) ?? "",
        ) ||
          suiteFunctions.has(
            baseCallName(node.expression.expression.expression, toolObjects) ?? "",
          ))
      ) {
        dynamic = true
        const callback = node.arguments[1]
        if (
          callback !== undefined &&
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        ) {
          ts.forEachChild(callback.body, (child) => visit(child, parents))
        }
        return
      }
      if (name !== undefined && wrappers.has(name)) {
        dynamic = true
        return
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "run" &&
        text.includes("RuleTester")
      ) {
        dynamic = true
        return
      }
    }
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      return
    }
    ts.forEachChild(node, (child) => visit(child, parents))
  }
  visit(source, [])
  if (factory?.body !== undefined) {
    ts.forEachChild(factory.body, (child) => visit(child, []))
  }
  let evidence: "static" | "dynamic" | "none" = "none"
  if (dynamic) evidence = "dynamic"
  if (cases.length > 0) evidence = "static"
  return {
    cases,
    evidence,
  }
}

const looksLikeTestSource = (file: string): boolean =>
  /(?:^|\/)(?:__tests__\/.*|[^/]+\.(?:test|spec)\.)(?:js|jsx|ts|tsx)$/.test(file) ||
  /(?:\/ios\/Tests\/|\/Tests\/).*\.(?:m|mm|swift)$/.test(file) ||
  /\/src\/(?:test|androidTest)\/.*\.(?:java|kt)$/.test(file) ||
  /\/(?:__e2e__|e2e|maestro|\.maestro)\/.*\.ya?ml$/.test(file)

/**
 * Discovers and classifies the complete pinned Expo test corpus.
 *
 * @remarks
 * Suite rules are applied with deterministic precedence. Every suite must match
 * a uniquely assigned source, and unassigned test-looking files fail closed.
 *
 * @returns The versioned corpus snapshot and deterministic fingerprint.
 * @throws {@link HarnessError} for stale rules, invalid patterns, empty suites, or uncovered tests.
 */
export const discover = Effect.fn("Suites.discover")(function* () {
  const repository = yield* ExpoRepository
  const suites = yield* repository.readJson("compatibility/suites.json", Suites)
  if (suites.expoRevision !== repository.upstreams.expo.revision) {
    return yield* new HarnessError({
      operation: "validate suite revision",
      path: "compatibility/suites.json",
      cause: `found ${suites.expoRevision}; expected ${repository.upstreams.expo.revision}`,
    })
  }
  const files = yield* repository.expoFiles
  const compiled = yield* Effect.forEach(suites.suites, (suite) =>
    Effect.try({
      try: () => ({ suite, matchers: suite.match.map((pattern) => new RegExp.RegExp(pattern)) }),
      catch: (cause) =>
        new HarnessError({
          operation: "compile suite matcher",
          path: "compatibility/suites.json",
          cause,
        }),
    }),
  )
  const assigned = new Map<string, (typeof compiled)[number]["suite"]>()
  for (const { suite, matchers } of compiled.toReversed()) {
    for (const file of files) {
      if (!assigned.has(file) && matchers.some((matcher) => matcher.test(file))) {
        assigned.set(file, suite)
      }
    }
  }
  for (const suite of suites.suites) {
    if (![...assigned.values()].some((entry) => entry.id === suite.id)) {
      return yield* new HarnessError({
        operation: "discover suite",
        path: "compatibility/suites.json",
        cause: `suite ${suite.id} matched no uniquely assigned files`,
      })
    }
  }
  const unmatched = files.filter((file) => looksLikeTestSource(file) && !assigned.has(file))
  if (unmatched.length > 0) {
    return yield* new HarnessError({
      operation: "close test source denominator",
      path: "compatibility/suites.json",
      cause: `unclassified test-like sources: ${unmatched.join(", ")}`,
    })
  }

  const sources: Array<TestSource> = []
  for (const [file, suite] of assigned) {
    if (suite.executability === "non-executable" && suite.reason === null) {
      return yield* new HarnessError({
        operation: "validate suite executability",
        path: "compatibility/suites.json",
        cause: `suite ${suite.id} must explain why it is non-executable`,
      })
    }
    sources.push({
      id: TestSourceId.make(`${suite.id}#${file}`),
      suiteId: suite.id,
      runner: suite.runner,
      path: file,
      kind: suite.kind,
      platforms: suite.platforms,
      executability: suite.executability,
      reason: suite.reason,
    })
  }
  sources.sort((left, right) => left.id.localeCompare(right.id))

  const analyses = yield* Effect.forEach(
    sources.filter((source) => /\.[cm]?[jt]sx?$/.test(source.path)),
    (source) =>
      repository.readExpoText(source.path).pipe(
        Effect.map(
          (text) =>
            [
              source.id,
              analyzeCases(
                source.id,
                source.path,
                text,
                Match.value(source.runner).pipe(
                  Match.when("expo-jasmine", () => "test" as const),
                  Match.orElse(() => undefined),
                ),
              ),
            ] as const,
        ),
      ),
    { concurrency: 16 },
  )
  const evidence = new Map(analyses)
  const enrichedSources = sources.map((source) => {
    const analysis = evidence.get(source.id)
    return analysis === undefined ? source : { ...source, caseEvidence: analysis.evidence }
  })
  const cases = analyses
    .flatMap(([, analysis]) => analysis.cases)
    .toSorted((left, right) => left.id.localeCompare(right.id))
  const content = { sources: enrichedSources, cases }
  return {
    schemaVersion: 1,
    expoRevision: repository.upstreams.expo.revision,
    fingerprint: yield* repository.hashString(JSON.stringify(content)),
    ...content,
  } satisfies CorpusSnapshot
})
