/**
 * Stable diagnostics emitted by effect-expo policy checks.
 *
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * Machine-readable codes for architectural policy failures.
 *
 * @category schemas
 * @since 0.1.0
 */
export const DiagnosticCode = Schema.Literals([
  "EFFECT_EXPO_GENERATED_DRIFT",
  "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
  "EFFECT_EXPO_INTERNAL_IMPORT",
  "EFFECT_EXPO_UNMANAGED_RUNTIME",
  "EFFECT_EXPO_TESTING_IMPORT"
])

/**
 * A machine-readable architectural diagnostic code.
 *
 * @category models
 * @since 0.1.0
 */
export type DiagnosticCode = typeof DiagnosticCode.Type

/**
 * Hard limits for diagnostics crossing the CLI and agent boundary.
 *
 * @category constants
 * @since 0.1.0
 */
export const DiagnosticLimits = {
  file: 512,
  capability: 64,
  message: 512,
  help: 1024,
  count: 32,
  output: 196_608
} as const

const hasControlCharacter = (input: string): boolean => {
  for (const character of input) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 32 || (codePoint >= 127 && codePoint <= 159)) return true
  }
  return false
}

const safeText = (maximum: number) =>
  Schema.String.check(
    Schema.isMaxLength(maximum),
    Schema.makeFilter((input: string) => !hasControlCharacter(input), {
      expected: "text without control characters"
    })
  )

/**
 * Schema for a deterministic policy diagnostic suitable for humans and agents.
 *
 * @category schemas
 * @since 0.1.0
 */
export const Diagnostic = Schema.Struct({
  code: DiagnosticCode,
  severity: Schema.Literal("error"),
  message: safeText(DiagnosticLimits.message),
  file: safeText(DiagnosticLimits.file),
  line: Schema.Number.check(
    Schema.isFinite(),
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: 10_000_000 })
  ),
  capability: safeText(DiagnosticLimits.capability),
  help: safeText(DiagnosticLimits.help)
})

/**
 * A decoded policy diagnostic.
 *
 * @category models
 * @since 0.1.0
 */
export type Diagnostic = typeof Diagnostic.Type

const sanitizeText = (input: string, maximum: number): string => {
  let output = ""
  for (const character of input) {
    if (output.length + character.length > maximum) break
    const codePoint = character.codePointAt(0) ?? 0
    output += codePoint < 32 || (codePoint >= 127 && codePoint <= 159) ? " " : character
  }
  return output
}

/**
 * Constructs a bounded diagnostic safe for human and JSON rendering.
 *
 * @category constructors
 * @since 0.1.0
 */
export const makeDiagnostic = (input: {
  readonly code: DiagnosticCode
  readonly message: string
  readonly file: string
  readonly line: number
  readonly capability: string
  readonly help: string
}): Diagnostic => ({
  code: input.code,
  severity: "error",
  message: sanitizeText(input.message, DiagnosticLimits.message),
  file: sanitizeText(input.file, DiagnosticLimits.file),
  line:
    Number.isFinite(input.line) && Number.isInteger(input.line)
      ? Math.min(10_000_000, Math.max(1, input.line))
      : 1,
  capability: sanitizeText(input.capability, DiagnosticLimits.capability),
  help: sanitizeText(input.help, DiagnosticLimits.help)
})
