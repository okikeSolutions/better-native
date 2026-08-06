import ts from "typescript"

export interface PublicCompileDiagnostic {
  readonly code: number
  readonly category: "error" | "warning"
  readonly file?: string
  readonly line?: number
  readonly column?: number
  readonly message: string
}

export interface SanitizedDiagnostics {
  readonly diagnostics: ReadonlyArray<PublicCompileDiagnostic>
  readonly truncated: boolean
}

const maximumDiagnostics = 16
const maximumMessageLength = 512

const sanitizePath = (fileName: string): string | undefined => {
  const normalized = fileName.replaceAll("\\", "/")
  if (!normalized.startsWith("/workspace/")) return undefined
  const relative = normalized.slice("/workspace/".length)
  return relative.length > 0 && !relative.split("/").includes("..") ? relative : undefined
}

const sanitizeMessage = (message: string): string =>
  message
    .replaceAll(/\/workspace\//g, "")
    .replaceAll(/\/runner(?:\/[^\s'"`)\]}:,;]+)?/g, "[internal]")
    .replaceAll(/file:\/\/[^\s'"`)\]}:,;]+/g, "[internal]")
    .slice(0, maximumMessageLength)

/** Converts TypeScript diagnostics into a bounded, path-sanitized public result. */
export const sanitizeDiagnostics = (
  diagnostics: ReadonlyArray<ts.Diagnostic>,
): SanitizedDiagnostics => ({
  diagnostics: diagnostics.slice(0, maximumDiagnostics).map((diagnostic) => {
    const position =
      diagnostic.file === undefined || diagnostic.start === undefined
        ? undefined
        : diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    const file = diagnostic.file === undefined ? undefined : sanitizePath(diagnostic.file.fileName)
    return {
      code: diagnostic.code,
      category: diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "error",
      ...(file === undefined ? {} : { file }),
      ...(position === undefined
        ? {}
        : { line: position.line + 1, column: position.character + 1 }),
      message: sanitizeMessage(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    }
  }),
  truncated: diagnostics.length > maximumDiagnostics,
})
