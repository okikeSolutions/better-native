import {
  type Diagnostic,
  type DiagnosticCode,
  DiagnosticLimits,
  makeDiagnostic
} from "@effect-expo/core/Diagnostic"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as ts from "typescript"

const explanations: Record<DiagnosticCode, string> = {
  EFFECT_EXPO_GENERATED_DRIFT:
    "Generated output differs from its reviewed declarative source. Run `bun run generate` and review the resulting patch instead of editing generated files.",
  EFFECT_EXPO_RAW_CAPABILITY_IMPORT:
    "Application and domain code must use the Effect capability service. Raw Expo capability imports are limited to reviewed production adapters.",
  EFFECT_EXPO_INTERNAL_IMPORT:
    "Consumers must use package exports. Adapter, contract, generated, and src paths are implementation details.",
  EFFECT_EXPO_UNMANAGED_RUNTIME:
    "Effect runners are allowed only in reviewed application entrypoints. Domain code should return Effects to its caller.",
  EFFECT_EXPO_TESTING_IMPORT:
    "Testing Layers must not enter production application modules. Keep them in test and evaluation fixtures."
}

export const explainDiagnostic = (code: DiagnosticCode): string => explanations[code]

const diagnostic = (
  code: DiagnosticCode,
  file: string,
  line: number,
  capability: string,
  message: string
): Diagnostic =>
  makeDiagnostic({
    code,
    message,
    file,
    line,
    capability,
    help: explanations[code]
  })

const propertyOwner = (node: ts.Expression): ts.Expression | undefined =>
  ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
    ? node.expression
    : undefined

const bindingPropertyName = (element: ts.BindingElement): string | undefined => {
  const property = element.propertyName
  if (property === undefined) return ts.isIdentifier(element.name) ? element.name.text : undefined
  return ts.isIdentifier(property) || ts.isStringLiteral(property) || ts.isNumericLiteral(property)
    ? property.text
    : undefined
}

export const checkPolicySource = (file: string, source: string): Array<Diagnostic> => {
  const diagnostics: Array<Diagnostic> = []
  const normalizedFile = file.replaceAll("\\", "/")
  const scriptKind = /\.jsx$/i.test(normalizedFile)
    ? ts.ScriptKind.JSX
    : /\.tsx$/i.test(normalizedFile)
      ? ts.ScriptKind.TSX
      : /\.(?:js|mjs|cjs)$/i.test(normalizedFile)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind)
  const compilerOptions = {
    allowJs: true,
    checkJs: true,
    noLib: true,
    noResolve: true
  } satisfies ts.CompilerOptions
  const compilerHost = ts.createCompilerHost(compilerOptions)
  compilerHost.fileExists = (requestedFile) => requestedFile === file
  compilerHost.readFile = (requestedFile) => (requestedFile === file ? source : undefined)
  compilerHost.getSourceFile = (requestedFile) => (requestedFile === file ? sourceFile : undefined)
  const checker = ts
    .createProgram({ rootNames: [file], options: compilerOptions, host: compilerHost })
    .getTypeChecker()
  const isProductionSource =
    /^(?:apps|packages)\//.test(normalizedFile) &&
    !/(?:^|\/)generated(?:\/|$)/.test(normalizedFile) &&
    !/\.(?:test|spec|eval)\.[cm]?[jt]sx?$/.test(normalizedFile)
  const isApprovedAdapter = normalizedFile === "packages/network/src/adapters/NetworkLive.ts"
  const isApprovedRunner = new Set([
    "apps/test-suite/src/runtime/network-runtime.ts",
    "packages/cli/src/bin.ts"
  ]).has(normalizedFile)
  const effectRootNamespaces = new Set<ts.Symbol>()
  const effectNamespaces = new Set<ts.Symbol>()
  const effectRunners = new Set<ts.Symbol>()
  const expoNamespaces = new Set<ts.Symbol>()
  const expoNativeLoaders = new Set<ts.Symbol>()
  const expoNativeProxies = new Set<ts.Symbol>()
  const reactNativeNamespaces = new Set<ts.Symbol>()
  const reactNativeModules = new Set<ts.Symbol>()
  const commonJsLoaders = new Set<ts.Symbol>()
  const commonJsResolvers = new Set<ts.Symbol>()
  const staticStrings = new Map<ts.Symbol, string>()
  const runnerName = /^run(?:Fork|Callback|Promise|Sync)(?:Exit)?(?:With)?$/
  const nativeLoaderName = /^(?:requireNativeModule|requireOptionalNativeModule)$/

  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

  const symbolOf = (node: ts.Identifier): ts.Symbol | undefined => checker.getSymbolAtLocation(node)

  const isIdentifierIn = (node: ts.Expression, symbols: ReadonlySet<ts.Symbol>): boolean => {
    if (!ts.isIdentifier(node)) return false
    const symbol = symbolOf(node)
    return symbol !== undefined && symbols.has(symbol)
  }

  const isUnboundIdentifierNamed = (node: ts.Expression, name: string): boolean =>
    ts.isIdentifier(node) && node.text === name && symbolOf(node) === undefined

  const isCommonJsRequire = (node: ts.Expression): boolean => {
    if (!ts.isIdentifier(node) || node.text !== "require") return false
    const symbol = symbolOf(node)
    return (
      symbol === undefined || symbol.declarations === undefined || symbol.declarations.length === 0
    )
  }

  const addIdentifier = (symbols: Set<ts.Symbol>, identifier: ts.Identifier): boolean => {
    const symbol = symbolOf(identifier)
    if (symbol === undefined || symbols.has(symbol)) return false
    symbols.add(symbol)
    return true
  }

  const rawNetworkDiagnostic = (node: ts.Node, detail: string): void => {
    if (isApprovedAdapter) return
    diagnostics.push(
      diagnostic(
        "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
        file,
        lineOf(node),
        "network",
        `${detail} bypasses the reviewed Effect adapter`
      )
    )
  }

  const checkModuleSpecifier = (specifier: string, node: ts.Node): void => {
    if (specifier === "expo-network" || specifier.startsWith("expo-network/")) {
      rawNetworkDiagnostic(node, `Raw ${specifier} access`)
    }

    if (/^@effect-expo\/[^/]+\/(?:src|adapters|contracts|generated)(?:\/|$)/.test(specifier)) {
      diagnostics.push(
        diagnostic(
          "EFFECT_EXPO_INTERNAL_IMPORT",
          file,
          lineOf(node),
          "package-boundary",
          `Internal package import ${specifier} is not public API`
        )
      )
    }

    if (isProductionSource && /^@effect-expo\/[^/]+\/testing(?:\/|$)/.test(specifier)) {
      diagnostics.push(
        diagnostic(
          "EFFECT_EXPO_TESTING_IMPORT",
          file,
          lineOf(node),
          "testing",
          `Testing entrypoint ${specifier} is not allowed in production source`
        )
      )
    }

    if (isProductionSource && specifier.startsWith(".")) {
      const sourceSegments = normalizedFile.split("/")
      sourceSegments.pop()
      for (const segment of specifier.replaceAll("\\", "/").split("/")) {
        if (segment === "" || segment === ".") continue
        if (segment === "..") sourceSegments.pop()
        else sourceSegments.push(segment)
      }
      const target = sourceSegments.join("/")
      if (/(?:^|\/)testing(?:\/|$)/.test(target)) {
        diagnostics.push(
          diagnostic(
            "EFFECT_EXPO_TESTING_IMPORT",
            file,
            lineOf(node),
            "testing",
            `Testing module ${specifier} is not allowed in production source`
          )
        )
      }

      const sourcePackage = normalizedFile.match(/^packages\/([^/]+)\//)?.[1]
      const targetInternal = target.match(
        /^packages\/([^/]+)\/src\/(?:adapters|contracts|generated)(?:\/|$)/
      )
      if (targetInternal !== null && targetInternal[1] !== sourcePackage) {
        diagnostics.push(
          diagnostic(
            "EFFECT_EXPO_INTERNAL_IMPORT",
            file,
            lineOf(node),
            "package-boundary",
            `Cross-package internal import ${specifier} is not public API`
          )
        )
      }
    }
  }

  const staticString = (node: ts.Expression): string | undefined => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isIdentifier(node)) {
      const symbol = symbolOf(node)
      return symbol === undefined ? undefined : staticStrings.get(symbol)
    }
    if (ts.isParenthesizedExpression(node)) return staticString(node.expression)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticString(node.left)
      const right = staticString(node.right)
      return left === undefined || right === undefined ? undefined : left + right
    }
    return undefined
  }

  const propertyName = (node: ts.Expression): string | undefined =>
    ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && node.argumentExpression !== undefined
        ? staticString(node.argumentExpression)
        : undefined

  const reflectGet = (
    node: ts.Expression
  ): { readonly target: ts.Expression; readonly property: string } | undefined => {
    if (
      !ts.isCallExpression(node) ||
      propertyName(node.expression) !== "get" ||
      propertyOwner(node.expression) === undefined ||
      !isUnboundIdentifierNamed(propertyOwner(node.expression)!, "Reflect") ||
      node.arguments[0] === undefined ||
      node.arguments[1] === undefined
    ) {
      return undefined
    }
    const property = staticString(node.arguments[1])
    return property === undefined ? undefined : { target: node.arguments[0], property }
  }

  const isEffectNamespace = (node: ts.Expression): boolean => {
    if (isIdentifierIn(node, effectNamespaces)) return true
    const reflected = reflectGet(node)
    if (
      reflected !== undefined &&
      reflected.property === "Effect" &&
      isIdentifierIn(reflected.target, effectRootNamespaces)
    ) {
      return true
    }
    const owner = propertyOwner(node)
    return (
      owner !== undefined &&
      isIdentifierIn(owner, effectRootNamespaces) &&
      propertyName(node) === "Effect"
    )
  }

  const isExpoNamespace = (node: ts.Expression): boolean => isIdentifierIn(node, expoNamespaces)

  const isReactNativeModules = (node: ts.Expression): boolean => {
    if (isIdentifierIn(node, reactNativeModules)) return true
    const reflected = reflectGet(node)
    if (
      reflected !== undefined &&
      reflected.property === "NativeModules" &&
      isIdentifierIn(reflected.target, reactNativeNamespaces)
    ) {
      return true
    }
    const owner = propertyOwner(node)
    return (
      owner !== undefined &&
      isIdentifierIn(owner, reactNativeNamespaces) &&
      propertyName(node) === "NativeModules"
    )
  }

  const isExpoNativeProxy = (node: ts.Expression): boolean => {
    if (isIdentifierIn(node, expoNativeProxies)) return true
    const reflected = reflectGet(node)
    if (
      reflected !== undefined &&
      reflected.property === "NativeModulesProxy" &&
      isExpoNamespace(reflected.target)
    ) {
      return true
    }
    const owner = propertyOwner(node)
    return (
      owner !== undefined && isExpoNamespace(owner) && propertyName(node) === "NativeModulesProxy"
    )
  }

  const isEffectRunnerReference = (candidate: ts.Expression): boolean => {
    if (isIdentifierIn(candidate, effectRunners)) return true
    if (
      runnerName.test(propertyName(candidate) ?? "") &&
      propertyOwner(candidate) !== undefined &&
      isEffectNamespace(propertyOwner(candidate)!)
    ) {
      return true
    }
    const reflected = reflectGet(candidate)
    return (
      reflected !== undefined &&
      runnerName.test(reflected.property) &&
      isEffectNamespace(reflected.target)
    )
  }

  const collectImports = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text
      checkModuleSpecifier(specifier, node.moduleSpecifier)

      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly !== true) {
        const clause = node.importClause
        if (clause?.namedBindings !== undefined && specifier === "effect/Effect") {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            addIdentifier(effectNamespaces, clause.namedBindings.name)
          } else {
            for (const element of clause.namedBindings.elements) {
              if (element.isTypeOnly) continue
              const imported = element.propertyName?.text ?? element.name.text
              if (runnerName.test(imported)) addIdentifier(effectRunners, element.name)
            }
          }
        } else if (clause?.namedBindings !== undefined && specifier === "effect") {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            addIdentifier(effectRootNamespaces, clause.namedBindings.name)
          } else {
            for (const element of clause.namedBindings.elements) {
              if (element.isTypeOnly) continue
              const imported = element.propertyName?.text ?? element.name.text
              if (imported === "Effect") addIdentifier(effectNamespaces, element.name)
            }
          }
        } else if (
          clause?.namedBindings !== undefined &&
          (specifier === "expo" || specifier === "expo-modules-core")
        ) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            addIdentifier(expoNamespaces, clause.namedBindings.name)
          } else {
            for (const element of clause.namedBindings.elements) {
              if (element.isTypeOnly) continue
              const imported = element.propertyName?.text ?? element.name.text
              if (nativeLoaderName.test(imported)) addIdentifier(expoNativeLoaders, element.name)
              if (imported === "NativeModulesProxy") addIdentifier(expoNativeProxies, element.name)
            }
          }
        } else if (clause?.namedBindings !== undefined && specifier === "react-native") {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            addIdentifier(reactNativeNamespaces, clause.namedBindings.name)
          } else {
            for (const element of clause.namedBindings.elements) {
              if (element.isTypeOnly) continue
              const imported = element.propertyName?.text ?? element.name.text
              if (imported === "NativeModules") addIdentifier(reactNativeModules, element.name)
            }
          }
        }
      }
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      const specifier = node.moduleReference.expression.text
      checkModuleSpecifier(specifier, node.moduleReference.expression)
      if (specifier === "effect") addIdentifier(effectRootNamespaces, node.name)
      if (specifier === "effect/Effect") addIdentifier(effectNamespaces, node.name)
      if (specifier === "expo" || specifier === "expo-modules-core") {
        addIdentifier(expoNamespaces, node.name)
      }
      if (specifier === "react-native") addIdentifier(reactNativeNamespaces, node.name)
    }

    ts.forEachChild(node, collectImports)
  }

  collectImports(sourceFile)

  const requiredModuleSpecifier = (node: ts.Expression): string | undefined => {
    if (!ts.isCallExpression(node) || node.arguments[0] === undefined) return undefined
    const expression = node.expression
    const callsRequire =
      isCommonJsRequire(expression) || isIdentifierIn(expression, commonJsLoaders)
    const callsModuleRequire =
      propertyName(expression) === "require" &&
      propertyOwner(expression) !== undefined &&
      isUnboundIdentifierNamed(propertyOwner(expression)!, "module")
    return callsRequire || callsModuleRequire ? staticString(node.arguments[0]) : undefined
  }

  const dynamicModuleSpecifier = (expression: ts.Expression): string | undefined => {
    let node = expression
    while (
      ts.isAwaitExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      node = node.expression
    }
    return ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined
      ? staticString(node.arguments[0])
      : undefined
  }

  let aliasesChanged = true
  while (aliasesChanged) {
    aliasesChanged = false
    const add = (set: Set<ts.Symbol>, identifier: ts.Identifier): void => {
      if (addIdentifier(set, identifier)) {
        aliasesChanged = true
      }
    }
    const trackModuleBinding = (name: ts.BindingName, specifier: string): void => {
      if (ts.isIdentifier(name)) {
        if (specifier === "effect") add(effectRootNamespaces, name)
        if (specifier === "effect/Effect") add(effectNamespaces, name)
        if (specifier === "expo" || specifier === "expo-modules-core") {
          add(expoNamespaces, name)
        }
        if (specifier === "react-native") add(reactNativeNamespaces, name)
        return
      }
      if (!ts.isObjectBindingPattern(name)) return
      for (const element of name.elements) {
        if (!ts.isIdentifier(element.name)) continue
        const imported = bindingPropertyName(element)
        if (imported === undefined) continue
        if (specifier === "effect" && imported === "Effect") {
          add(effectNamespaces, element.name)
        }
        if (specifier === "effect/Effect" && runnerName.test(imported)) {
          add(effectRunners, element.name)
        }
        if (specifier === "expo" || specifier === "expo-modules-core") {
          if (nativeLoaderName.test(imported)) add(expoNativeLoaders, element.name)
          if (imported === "NativeModulesProxy") add(expoNativeProxies, element.name)
        }
        if (specifier === "react-native" && imported === "NativeModules") {
          add(reactNativeModules, element.name)
        }
      }
    }
    const collectAliases = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        const dynamic = dynamicModuleSpecifier(node.initializer)
        if (dynamic !== undefined) trackModuleBinding(node.name, dynamic)
        if (ts.isIdentifier(node.name)) {
          const value = node.initializer
          const resolved = staticString(value)
          const symbol = symbolOf(node.name)
          if (
            resolved !== undefined &&
            symbol !== undefined &&
            staticStrings.get(symbol) !== resolved
          ) {
            staticStrings.set(symbol, resolved)
            aliasesChanged = true
          }
          if (isEffectNamespace(value)) add(effectNamespaces, node.name)
          if (isEffectRunnerReference(value)) add(effectRunners, node.name)
          const reflected = reflectGet(value)
          if (isIdentifierIn(value, expoNativeLoaders)) add(expoNativeLoaders, node.name)
          if (
            (isExpoNamespace(propertyOwner(value) ?? value) &&
              nativeLoaderName.test(propertyName(value) ?? "")) ||
            (reflected !== undefined &&
              isExpoNamespace(reflected.target) &&
              nativeLoaderName.test(reflected.property))
          ) {
            add(expoNativeLoaders, node.name)
          }
          if (isReactNativeModules(value)) add(reactNativeModules, node.name)
          if (isExpoNativeProxy(value)) add(expoNativeProxies, node.name)
          if (
            isCommonJsRequire(value) ||
            isIdentifierIn(value, commonJsLoaders) ||
            (propertyName(value) === "require" &&
              propertyOwner(value) !== undefined &&
              isUnboundIdentifierNamed(propertyOwner(value)!, "module"))
          ) {
            add(commonJsLoaders, node.name)
          }
          if (
            isIdentifierIn(value, commonJsResolvers) ||
            (propertyName(value) === "resolve" &&
              propertyOwner(value) !== undefined &&
              (isCommonJsRequire(propertyOwner(value)!) ||
                isIdentifierIn(propertyOwner(value)!, commonJsLoaders)))
          ) {
            add(commonJsResolvers, node.name)
          }

          const required = requiredModuleSpecifier(value)
          if (required === "effect") add(effectRootNamespaces, node.name)
          if (required === "effect/Effect") add(effectNamespaces, node.name)
          if (required === "expo" || required === "expo-modules-core") {
            add(expoNamespaces, node.name)
          }
          if (required === "react-native") add(reactNativeNamespaces, node.name)

          if (
            ts.isCallExpression(value) &&
            propertyName(value.expression) === "bind" &&
            propertyOwner(value.expression) !== undefined
          ) {
            const bound = propertyOwner(value.expression)!
            if (isEffectRunnerReference(bound)) {
              add(effectRunners, node.name)
            }
          }
        } else if (ts.isObjectBindingPattern(node.name)) {
          const required = requiredModuleSpecifier(node.initializer)
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue
            const imported = bindingPropertyName(element)
            if (imported === undefined) continue
            if (
              (isEffectNamespace(node.initializer) || required === "effect/Effect") &&
              runnerName.test(imported)
            ) {
              add(effectRunners, element.name)
            }
            if (
              (isIdentifierIn(node.initializer, effectRootNamespaces) || required === "effect") &&
              imported === "Effect"
            ) {
              add(effectNamespaces, element.name)
            }
            if (
              (isExpoNamespace(node.initializer) ||
                required === "expo" ||
                required === "expo-modules-core") &&
              nativeLoaderName.test(imported)
            ) {
              add(expoNativeLoaders, element.name)
            }
            if (
              (isExpoNamespace(node.initializer) ||
                required === "expo" ||
                required === "expo-modules-core") &&
              imported === "NativeModulesProxy"
            ) {
              add(expoNativeProxies, element.name)
            }
            if (
              (isIdentifierIn(node.initializer, reactNativeNamespaces) ||
                required === "react-native") &&
              imported === "NativeModules"
            ) {
              add(reactNativeModules, element.name)
            }
          }
        }
      }
      ts.forEachChild(node, collectAliases)
    }
    collectAliases(sourceFile)
  }

  const checkPolicyNode = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      const firstArgument = node.arguments[0]
      if (expression.kind === ts.SyntaxKind.ImportKeyword && firstArgument !== undefined) {
        // This checker is a static architectural guard, not an import sandbox. Calls whose
        // specifier cannot be resolved from local string constants remain outside its scope.
        const specifier = staticString(firstArgument)
        if (specifier !== undefined) checkModuleSpecifier(specifier, firstArgument)
      } else if (
        (isCommonJsRequire(expression) || isIdentifierIn(expression, commonJsLoaders)) &&
        firstArgument !== undefined
      ) {
        const specifier = staticString(firstArgument)
        if (specifier !== undefined) checkModuleSpecifier(specifier, firstArgument)
      } else if (
        propertyName(expression) === "require" &&
        propertyOwner(expression) !== undefined &&
        isUnboundIdentifierNamed(propertyOwner(expression)!, "module") &&
        firstArgument !== undefined
      ) {
        const specifier = staticString(firstArgument)
        if (specifier !== undefined) checkModuleSpecifier(specifier, firstArgument)
      } else if (isIdentifierIn(expression, commonJsResolvers) && firstArgument !== undefined) {
        const specifier = staticString(firstArgument)
        if (specifier !== undefined) checkModuleSpecifier(specifier, firstArgument)
      } else if (
        propertyName(expression) === "resolve" &&
        propertyOwner(expression) !== undefined &&
        (isCommonJsRequire(propertyOwner(expression)!) ||
          isIdentifierIn(propertyOwner(expression)!, commonJsLoaders)) &&
        firstArgument !== undefined
      ) {
        const specifier = staticString(firstArgument)
        if (specifier !== undefined) checkModuleSpecifier(specifier, firstArgument)
      }

      const nativeModuleName = firstArgument === undefined ? undefined : staticString(firstArgument)
      const reflectedExpression = reflectGet(expression)
      const callsNativeLoader =
        isIdentifierIn(expression, expoNativeLoaders) ||
        (nativeLoaderName.test(propertyName(expression) ?? "") &&
          propertyOwner(expression) !== undefined &&
          isExpoNamespace(propertyOwner(expression)!)) ||
        (reflectedExpression !== undefined &&
          nativeLoaderName.test(reflectedExpression.property) &&
          isExpoNamespace(reflectedExpression.target))
      if (callsNativeLoader && nativeModuleName === "ExpoNetwork") {
        rawNetworkDiagnostic(expression, "Direct ExpoNetwork native-module loading")
      }

      const invocationHelper = propertyName(expression)
      const callsRunner =
        isEffectRunnerReference(expression) ||
        ((invocationHelper === "call" ||
          invocationHelper === "apply" ||
          invocationHelper === "bind") &&
          propertyOwner(expression) !== undefined &&
          isEffectRunnerReference(propertyOwner(expression)!))
      if (isProductionSource && !isApprovedRunner && callsRunner) {
        diagnostics.push(
          diagnostic(
            "EFFECT_EXPO_UNMANAGED_RUNTIME",
            file,
            lineOf(expression),
            "runtime",
            "Effect runner is outside a reviewed runtime entrypoint"
          )
        )
      }
    }

    const reflectedNode = ts.isExpression(node) ? reflectGet(node) : undefined
    const accessesExpoNetwork =
      ts.isExpression(node) &&
      ((propertyName(node) === "ExpoNetwork" &&
        propertyOwner(node) !== undefined &&
        (isReactNativeModules(propertyOwner(node)!) || isExpoNativeProxy(propertyOwner(node)!))) ||
        (reflectedNode !== undefined &&
          reflectedNode.property === "ExpoNetwork" &&
          (isReactNativeModules(reflectedNode.target) || isExpoNativeProxy(reflectedNode.target))))
    if (accessesExpoNetwork) {
      rawNetworkDiagnostic(node, "Direct ExpoNetwork native-module access")
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined
    ) {
      if (isReactNativeModules(node.initializer) || isExpoNativeProxy(node.initializer)) {
        for (const element of node.name.elements) {
          const imported = bindingPropertyName(element)
          if (imported === "ExpoNetwork") {
            rawNetworkDiagnostic(element, "Direct ExpoNetwork native-module destructuring")
          }
        }
      }
    }

    ts.forEachChild(node, checkPolicyNode)
  }

  checkPolicyNode(sourceFile)

  return diagnostics
}

export const checkPolicies = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const roots = ["packages", "apps"]
  const files = yield* Effect.flatMap(
    Effect.filter(roots, (root) => fs.exists(root)),
    (existing) =>
      Effect.forEach(existing, (root) =>
        fs
          .glob("**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}", {
            root,
            exclude: [
              "**/node_modules/**",
              "**/*.{test,spec,eval}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
              "**/generated/**",
              "**/.expo/**"
            ]
          })
          .pipe(
            Effect.map((entries) =>
              entries.map((entry) => (entry.startsWith(root) ? entry : `${root}/${entry}`))
            )
          )
      )
  )

  return yield* Effect.forEach(files.flat(), (file) =>
    fs.readFileString(file).pipe(Effect.map((source) => checkPolicySource(file, source)))
  ).pipe(Effect.map((results) => results.flat()))
})

export const renderDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>,
  format: "human" | "json"
): string => {
  if (diagnostics.length === 0 && format === "human") return "effect-expo check passed"
  const bounded = diagnostics.slice(0, DiagnosticLimits.count).map((item) => makeDiagnostic(item))
  const render = (): string =>
    (() => {
      const omitted = Math.max(0, diagnostics.length - bounded.length)
      return format === "json"
        ? JSON.stringify(
            { schemaVersion: 1, diagnostics: bounded, ...(omitted > 0 ? { omitted } : {}) },
            null,
            2
          )
        : [
            ...bounded.map(
              (item) => `${item.file}:${item.line} ${item.code}\n  ${item.message}\n  ${item.help}`
            ),
            ...(omitted > 0 ? [`${omitted} additional diagnostic(s) omitted`] : [])
          ].join("\n\n")
    })()
  let output = render()
  while (output.length > DiagnosticLimits.output && bounded.length > 0) {
    bounded.pop()
    output = render()
  }
  return output
}
