import * as RegExp from "effect/RegExp"
import type { Json } from "effect/Schema"
import { Subpath, type Entrypoint, type ExpandedEntrypoint } from "../Domain.ts"

const isRecord = (value: Json): value is { readonly [key: string]: Json } =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const targets = (value: Json): ReadonlyArray<string> => {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(targets)
  if (isRecord(value)) return Object.values(value).flatMap(targets)
  return []
}

/**
 * Extracts wildcard captures from one declared export pattern and file path.
 *
 * @remarks
 * Captures are matched segment-by-segment so a wildcard cannot consume a path
 * separator that the package export pattern did not declare.
 *
 * @param pattern - Export pattern from the package manifest.
 * @param file - Candidate relative file path.
 * @returns The wildcard value, or `undefined` when the file does not match.
 */
const capture = (pattern: string, file: string): string | undefined => {
  const wildcard = pattern.indexOf("*")
  if (wildcard === -1) return undefined
  const expression = new RegExp.RegExp(
    `^${RegExp.escape(pattern.slice(0, wildcard))}(.+)${RegExp.escape(pattern.slice(wildcard + 1))}$`,
  )
  return expression.exec(file)?.[1]
}

const withoutDotSlash = (value: string): string => (value.startsWith("./") ? value.slice(2) : value)

/**
 * Expands one wildcard export against files in the installed package.
 *
 * @remarks
 * Only files selected by the package's export target are returned, and output
 * ordering is deterministic so generated surface fingerprints remain stable.
 *
 * @param entrypoint - Declared wildcard entrypoint and resolution branches.
 * @param files - Relative files available in the package.
 * @param declarationSource - Authority that supplied the package declaration.
 * @returns Expanded entrypoints with their matched files.
 */
export const expand = (
  entrypoint: Entrypoint,
  files: ReadonlyArray<string>,
  declarationSource: ExpandedEntrypoint["declarationSource"] = "pinned",
): ReadonlyArray<ExpandedEntrypoint> => {
  if (!entrypoint.pattern) return []

  const captures = new Map<string, Set<string>>()
  for (const target of targets(entrypoint.resolution.value)) {
    if (!target.includes("*")) continue
    for (const file of files) {
      const value = capture(withoutDotSlash(target), file)
      if (value === undefined) continue
      const matched = captures.get(value) ?? new Set<string>()
      matched.add(file)
      captures.set(value, matched)
    }
  }

  return [...captures]
    .map(([value, matchedFiles]) => ({
      declarationSource,
      declaredSubpath: entrypoint.subpath,
      subpath: Subpath.make(entrypoint.subpath.replaceAll("*", value)),
      matchedFiles: [...matchedFiles].toSorted(),
    }))
    .toSorted((left, right) => left.subpath.localeCompare(right.subpath))
}
