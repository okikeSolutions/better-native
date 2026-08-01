/**
 * Declarative specifications used to generate Effect-native Expo capabilities.
 *
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as RegExp from "effect/RegExp"

const CommentTerminator = new RegExp.RegExp(RegExp.escape("*/"))

const DocumentationText = Schema.NonEmptyString.check(
  Schema.makeFilter((text: string) => !CommentTerminator.test(text), {
    expected: "documentation text without a comment terminator"
  })
)

const TypeScriptReservedIdentifiers: ReadonlySet<string> = new Set([
  "any",
  "as",
  "asserts",
  "async",
  "await",
  "bigint",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "constructor",
  "continue",
  "debugger",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "is",
  "keyof",
  "let",
  "module",
  "namespace",
  "never",
  "new",
  "null",
  "number",
  "object",
  "of",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "require",
  "return",
  "satisfies",
  "set",
  "static",
  "string",
  "super",
  "switch",
  "symbol",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "unique",
  "unknown",
  "using",
  "var",
  "void",
  "while",
  "with",
  "yield"
])

const Identifier = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
  Schema.makeFilter((identifier: string) => !TypeScriptReservedIdentifiers.has(identifier), {
    expected: "a non-reserved TypeScript identifier"
  })
)

const Platform = Schema.Literals(["android", "ios", "web"])

const OperationSpec = Schema.Struct({
  name: Identifier,
  upstream: Identifier,
  kind: Schema.Literals(["effect", "stream"]),
  platforms: Schema.Array(Platform).check(Schema.isMinLength(1)),
  success: Identifier,
  error: Identifier,
  evidence: Schema.Struct({
    adapter: Schema.Literals(["complete", "missing", "unverified"]),
    scenario: Schema.Literals(["complete", "missing", "unverified"])
  }),
  documentation: Schema.Struct({
    summary: DocumentationText,
    failures: Schema.Array(DocumentationText)
  })
})

const UnimplementedOperationSpec = Schema.Struct({
  upstream: Identifier,
  kind: Schema.Literals(["effect", "event-source", "react-hook"]),
  treatment: Schema.Literals(["missing", "derive-from-service"]),
  platforms: Schema.Array(Platform).check(Schema.isMinLength(1))
})

/**
 * Closed, non-executable input accepted by capability generators.
 *
 * Documentation is data so generated declarations cannot drift from their
 * capability specification. Documentation text rejects comment terminators to
 * keep generation from crossing the TypeScript comment boundary.
 *
 * @category schemas
 * @since 0.1.0
 */
export const CapabilitySpec = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/)),
  service: Identifier,
  documentation: Schema.Struct({
    summary: DocumentationText,
    details: Schema.Array(DocumentationText),
    category: DocumentationText,
    since: Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/)),
    platforms: Schema.Array(
      Schema.Struct({
        name: Platform,
        behavior: DocumentationText
      })
    ).check(Schema.isMinLength(1))
  }),
  operations: Schema.Array(OperationSpec).check(Schema.isMinLength(1)),
  native: Schema.Struct({
    package: Schema.String.check(Schema.isPattern(/^expo-[a-z0-9-]+$/)),
    configPlugins: Schema.Array(Schema.String),
    androidPermissions: Schema.Array(
      Schema.String.check(Schema.isPattern(/^android\.permission\.[A-Z0-9_]+$/))
    ),
    unimplementedOperations: Schema.Array(UnimplementedOperationSpec)
  })
}).check(
  Schema.makeFilter(
    (spec) => {
      const effectNames = spec.operations.map((operation) => operation.name)
      const upstreamNames = [
        ...spec.operations.map((operation) => operation.upstream),
        ...spec.native.unimplementedOperations.map((operation) => operation.upstream)
      ]
      return (
        new Set(effectNames).size === effectNames.length &&
        new Set(upstreamNames).size === upstreamNames.length
      )
    },
    { expected: "unique Effect and upstream operation identifiers" }
  )
)

/**
 * A decoded capability specification accepted by the generator.
 *
 * @category models
 * @since 0.1.0
 */
export type CapabilitySpec = typeof CapabilitySpec.Type

/**
 * Decodes an unknown value as a closed capability specification.
 *
 * Excess properties and unsafe documentation comment terminators are rejected.
 *
 * @category decoding
 * @since 0.1.0
 */
export const decodeCapabilitySpec = Schema.decodeUnknownEffect(CapabilitySpec, {
  onExcessProperty: "error"
})
