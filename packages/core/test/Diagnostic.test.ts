import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Diagnostic, DiagnosticLimits, makeDiagnostic } from "../src/Diagnostic.ts"

const hasControlCharacter = (input: string): boolean =>
  Array.from(input).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || (codePoint >= 127 && codePoint <= 159)
  })

describe("Diagnostic", () => {
  it.effect.prop("generates only bounded protocol-safe diagnostics", [Diagnostic], ([value]) =>
    Effect.sync(() => {
      expect(value.file.length).toBeLessThanOrEqual(DiagnosticLimits.file)
      expect(value.capability.length).toBeLessThanOrEqual(DiagnosticLimits.capability)
      expect(value.message.length).toBeLessThanOrEqual(DiagnosticLimits.message)
      expect(value.help.length).toBeLessThanOrEqual(DiagnosticLimits.help)
      expect(
        hasControlCharacter(`${value.file}${value.capability}${value.message}${value.help}`)
      ).toBe(false)
      expect(Number.isSafeInteger(value.line)).toBe(true)
      expect(value.line).toBeGreaterThanOrEqual(1)
      expect(value.line).toBeLessThanOrEqual(10_000_000)
    })
  )

  it.effect("sanitizes arbitrary constructor input into the public Schema", () =>
    Effect.gen(function* () {
      const value = makeDiagnostic({
        code: "EFFECT_EXPO_INTERNAL_IMPORT",
        file: `file\n${"f".repeat(2_000)}`,
        line: Number.NaN,
        capability: `package\u0000${"c".repeat(200)}`,
        message: `message\r${"m".repeat(2_000)}`,
        help: `help\t${"h".repeat(3_000)}`
      })

      yield* Schema.decodeUnknownEffect(Diagnostic)(value)
      expect(
        hasControlCharacter(`${value.file}${value.capability}${value.message}${value.help}`)
      ).toBe(false)
    })
  )
})
