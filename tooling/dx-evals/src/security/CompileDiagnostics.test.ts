import { assert, describe, it } from "@effect/vitest"
import ts from "typescript"
import { sanitizeDiagnostics } from "../../runner/CompileDiagnostics.ts"

describe("public compile diagnostics", () => {
  it("bounds diagnostics and removes host and runner paths", () => {
    const source = ts.createSourceFile(
      "/workspace/src/Example.ts",
      "export const value = 1\n",
      ts.ScriptTarget.ES2022,
    )
    const diagnostics: Array<ts.Diagnostic> = Array.from({ length: 20 }, (_, index) => ({
      category: ts.DiagnosticCategory.Error,
      code: 9000 + index,
      file: source,
      start: 0,
      length: 1,
      messageText:
        "Failure in /workspace/src/Example.ts via /runner/private/check.ts and " +
        "file:///Users/operator/repository/private.ts",
    }))

    const result = sanitizeDiagnostics(diagnostics)

    assert.strictEqual(result.diagnostics.length, 16)
    assert.isTrue(result.truncated)
    assert.strictEqual(result.diagnostics[0]?.file, "src/Example.ts")
    assert.strictEqual(result.diagnostics[0]?.line, 1)
    assert.strictEqual(result.diagnostics[0]?.column, 1)
    assert.notInclude(result.diagnostics[0]?.message ?? "", "/workspace")
    assert.notInclude(result.diagnostics[0]?.message ?? "", "/runner")
    assert.notInclude(result.diagnostics[0]?.message ?? "", "/Users/operator")
    assert.include(result.diagnostics[0]?.message ?? "", "[internal]")
  })

  it("withholds diagnostic paths outside the candidate workspace", () => {
    const source = ts.createSourceFile(
      "/runner/internal.ts",
      "export const value = 1\n",
      ts.ScriptTarget.ES2022,
    )
    const result = sanitizeDiagnostics([
      {
        category: ts.DiagnosticCategory.Warning,
        code: 9001,
        file: source,
        start: 0,
        length: 1,
        messageText: "internal warning",
      },
    ])

    assert.strictEqual(result.diagnostics[0]?.category, "warning")
    assert.notProperty(result.diagnostics[0] ?? {}, "file")
  })
})
