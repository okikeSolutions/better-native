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

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const capture = (pattern: string, file: string): string | undefined => {
  const wildcard = pattern.indexOf("*")
  if (wildcard === -1) return undefined
  const expression = new RegExp(
    `^${escapeRegex(pattern.slice(0, wildcard))}(.+)${escapeRegex(pattern.slice(wildcard + 1))}$`,
  )
  return expression.exec(file)?.[1]
}

const withoutDotSlash = (value: string): string => (value.startsWith("./") ? value.slice(2) : value)

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
