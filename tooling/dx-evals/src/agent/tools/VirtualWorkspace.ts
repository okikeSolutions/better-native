import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as Domain from "../../Domain.ts"

/** Validated, versioned limits defining the virtual-workspace portion of the coding harness. */
export const Limits = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  maximumReadLines: Domain.PositiveInteger,
  maximumOutputBytes: Domain.PositiveInteger,
  maximumSearchMatches: Domain.PositiveInteger,
  maximumSearchLineCharacters: Domain.PositiveInteger,
  maximumSearchContextLines: Domain.PositiveInteger,
  maximumPathResults: Domain.PositiveInteger,
  defaultListResults: Domain.PositiveInteger,
  maximumPatternCharacters: Domain.PositiveInteger,
  maximumEdits: Domain.PositiveInteger,
}).check(
  Schema.makeFilter((limits) => limits.defaultListResults <= limits.maximumPathResults, {
    expected: "virtual-workspace limits whose default list size does not exceed the path ceiling",
  }),
)
export type Limits = Schema.Schema.Type<typeof Limits>

/** Reviewed virtual-workspace limits shared by schemas, handlers, tests, and evidence metadata. */
export const defaultLimits = Schema.decodeUnknownSync(Limits)({
  schemaVersion: 1,
  maximumReadLines: 2_000,
  maximumOutputBytes: 50 * 1_024,
  maximumSearchMatches: 100,
  maximumSearchLineCharacters: 500,
  maximumSearchContextLines: 5,
  maximumPathResults: 1_000,
  defaultListResults: 500,
  maximumPatternCharacters: 256,
  maximumEdits: 16,
})

export const ListRequest = Schema.Struct({
  path: Schema.optional(Schema.NullOr(Schema.String)),
  limit: Schema.optional(Schema.NullOr(Schema.Number)),
})
export type ListRequest = Schema.Schema.Type<typeof ListRequest>

export const FindRequest = Schema.Struct({
  pattern: Schema.String,
  path: Schema.optional(Schema.NullOr(Schema.String)),
  limit: Schema.optional(Schema.NullOr(Schema.Number)),
})
export type FindRequest = Schema.Schema.Type<typeof FindRequest>

export const ReadRequest = Schema.Struct({
  path: Schema.String,
  // Decode JSON numbers and explicit nulls here. Some providers serialize omitted
  // optional arguments as null; the handler applies the same defaults for null and
  // undefined and returns bounded feedback for invalid numeric values.
  offset: Schema.optional(Schema.NullOr(Schema.Number)),
  limit: Schema.optional(Schema.NullOr(Schema.Number)),
})
export type ReadRequest = Schema.Schema.Type<typeof ReadRequest>

export const SearchRequest = Schema.Struct({
  pattern: Schema.String,
  path: Schema.optional(Schema.NullOr(Schema.String)),
  ignoreCase: Schema.optional(Schema.NullOr(Schema.Boolean)),
  literal: Schema.optional(Schema.NullOr(Schema.Boolean)),
  glob: Schema.optional(Schema.NullOr(Schema.String)),
  context: Schema.optional(Schema.NullOr(Schema.Number)),
  limit: Schema.optional(Schema.NullOr(Schema.Number)),
})
export type SearchRequest = Schema.Schema.Type<typeof SearchRequest>

const EditReplacement = Schema.Struct({
  oldText: Schema.String,
  newText: Schema.String,
})

/**
 * One root object keeps the tool compatible with OpenAI-style structured
 * output, which rejects an `anyOf` at the root. The handler requires either a
 * non-empty `edits` batch or both single-edit fields.
 */
export const EditRequest = Schema.Struct({
  path: Schema.String,
  edits: Schema.optional(Schema.Array(EditReplacement)),
  oldText: Schema.optional(Schema.String),
  newText: Schema.optional(Schema.String),
})
export type EditRequest = Schema.Schema.Type<typeof EditRequest>

const editReplacements = (
  request: EditRequest,
): ReadonlyArray<Schema.Schema.Type<typeof EditReplacement>> =>
  Match.value(request).pipe(
    Match.when(
      (candidate) => candidate.edits !== undefined,
      (candidate) => candidate.edits ?? [],
    ),
    Match.when(
      (candidate) => candidate.oldText !== undefined && candidate.newText !== undefined,
      (candidate) => [{ oldText: candidate.oldText!, newText: candidate.newText! }],
    ),
    Match.orElse(() => []),
  )

const PathFailure = Schema.Struct({
  ok: Schema.Literal(false),
  error: Schema.Literals(["unsafe-path", "invalid-pattern", "invalid-limit", "path-not-found"]),
})
export const PathResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    paths: Schema.Array(Schema.String),
    truncated: Schema.Boolean,
  }),
  PathFailure,
])
export type PathResult = Schema.Schema.Type<typeof PathResult>

export const ReadResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    content: Schema.String,
    startLine: Schema.Int,
    endLine: Schema.Int,
    totalLines: Schema.Int,
    truncated: Schema.Boolean,
    nextOffset: Schema.optional(Schema.Int),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error: Schema.Literals([
      "file-not-found",
      "invalid-offset",
      "invalid-limit",
      "offset-out-of-bounds",
      "line-size-limit",
    ]),
  }),
])
export type ReadResult = Schema.Schema.Type<typeof ReadResult>

export const SearchMatch = Schema.Struct({
  path: Schema.String,
  line: Schema.Int,
  content: Schema.String,
})
export type SearchMatch = Schema.Schema.Type<typeof SearchMatch>

export const SearchResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    matches: Schema.Array(SearchMatch),
    truncated: Schema.Boolean,
    searchedFiles: Schema.Int,
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error: Schema.Literals([
      "invalid-pattern",
      "invalid-limit",
      "invalid-context",
      "path-not-found",
      "invalid-glob",
    ]),
  }),
])
export type SearchResult = Schema.Schema.Type<typeof SearchResult>

export const EditResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    content: Schema.String,
    replacements: Schema.Int,
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error: Schema.Literals([
      "invalid-edit-count",
      "empty-old-text",
      "old-text-not-found",
      "old-text-not-unique",
      "overlapping-edits",
    ]),
  }),
])
export type EditResult = Schema.Schema.Type<typeof EditResult>

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength

const safeRoot = (value: string | null | undefined): string | undefined => {
  const root = (value ?? ".").replace(/^\.\//, "").replace(/\/$/, "")
  if (root === "." || root === "") return ""
  if (root.startsWith("/") || root.split("/").includes("..")) return undefined
  return root
}

const globExpression = (pattern: string, maximumPatternCharacters: number): RegExp | undefined => {
  if (pattern.length === 0 || pattern.length > maximumPatternCharacters) return undefined
  let source = "^"
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!
    source += Match.value(character).pipe(
      Match.when("*", () =>
        Match.value({ globstar: pattern[index + 1] === "*" }).pipe(
          Match.when({ globstar: false }, () => "[^/]*"),
          Match.when({ globstar: true }, () => {
            index += 1
            return Match.value({
              directoryGlobstar: pattern[index + 1] === "/",
            }).pipe(
              Match.when({ directoryGlobstar: true }, () => {
                index += 1
                return "(?:.*/)?"
              }),
              Match.when({ directoryGlobstar: false }, () => ".*"),
              Match.exhaustive,
            )
          }),
          Match.exhaustive,
        ),
      ),
      Match.when("?", () => "[^/]"),
      Match.orElse((literal) => literal.replace(/[|\\{}()[\]^$+*.]/g, "\\$&")),
    )
  }
  return new RegExp(`${source}$`)
}

const regularExpression = (pattern: string, ignoreCase: boolean): RegExp | undefined => {
  try {
    return new RegExp(
      pattern,
      Match.value(ignoreCase).pipe(
        Match.when(true, () => "i"),
        Match.when(false, () => ""),
        Match.exhaustive,
      ),
    )
  } catch {
    return undefined
  }
}

/** Lists immediate children of one allowlisted virtual directory. */
export const list = (
  files: ReadonlyMap<string, string>,
  request: ListRequest,
  limits: Limits = defaultLimits,
): PathResult => {
  const root = safeRoot(request.path)
  if (root === undefined) return { ok: false, error: "unsafe-path" }
  const requestedLimit = request.limit ?? limits.defaultListResults
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    return { ok: false, error: "invalid-limit" }
  }
  const prefix = Match.value(root.length === 0).pipe(
    Match.when(true, () => ""),
    Match.when(false, () => `${root}/`),
    Match.exhaustive,
  )
  const entries = new Set<string>()
  for (const path of files.keys()) {
    if (!path.startsWith(prefix)) continue
    const remainder = path.slice(prefix.length)
    const slash = remainder.indexOf("/")
    entries.add(
      Match.value(slash === -1).pipe(
        Match.when(true, () => remainder),
        Match.when(false, () => `${remainder.slice(0, slash)}/`),
        Match.exhaustive,
      ),
    )
  }
  if (entries.size === 0 && root.length > 0) return { ok: false, error: "path-not-found" }
  const limit = Math.min(requestedLimit, limits.maximumPathResults)
  const sorted = [...entries].toSorted((left, right) => left.localeCompare(right))
  return {
    ok: true,
    paths: sorted.slice(0, limit),
    truncated: sorted.length > limit,
  }
}

/** Finds allowlisted virtual files using a bounded glob relative to an optional directory. */
export const find = (
  files: ReadonlyMap<string, string>,
  request: FindRequest,
  limits: Limits = defaultLimits,
): PathResult => {
  const root = safeRoot(request.path)
  if (root === undefined) return { ok: false, error: "unsafe-path" }
  const expression = globExpression(request.pattern, limits.maximumPatternCharacters)
  if (expression === undefined) return { ok: false, error: "invalid-pattern" }
  const requestedLimit = request.limit ?? limits.maximumPathResults
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    return { ok: false, error: "invalid-limit" }
  }
  const prefix = Match.value(root.length === 0).pipe(
    Match.when(true, () => ""),
    Match.when(false, () => `${root}/`),
    Match.exhaustive,
  )
  const matches = [...files.keys()]
    .filter((path) => path.startsWith(prefix) && expression.test(path.slice(prefix.length)))
    .toSorted()
  if (root.length > 0 && ![...files.keys()].some((path) => path.startsWith(prefix))) {
    return { ok: false, error: "path-not-found" }
  }
  const limit = Math.min(requestedLimit, limits.maximumPathResults)
  return {
    ok: true,
    paths: matches.slice(0, limit),
    truncated: matches.length > limit,
  }
}

const completeLinesWithinBytes = (lines: ReadonlyArray<string>, maximumBytes: number) => {
  const retained: Array<string> = []
  let retainedBytes = 0
  for (const line of lines) {
    const separatorBytes = Match.value(retained.length === 0).pipe(
      Match.when(true, () => 0),
      Match.when(false, () => 1),
      Match.exhaustive,
    )
    const lineBytes = utf8Bytes(line) + separatorBytes
    if (retainedBytes + lineBytes > maximumBytes) break
    retained.push(line)
    retainedBytes += lineBytes
  }
  return retained
}

/** Reads one bounded, line-addressable view from an allowlisted virtual workspace file. */
export const read = (
  files: ReadonlyMap<string, string>,
  request: ReadRequest,
  limits: Limits = defaultLimits,
): ReadResult => {
  const content = files.get(request.path)
  if (content === undefined) return { ok: false, error: "file-not-found" }
  const offset = request.offset ?? 1
  const requestedLimit = request.limit ?? limits.maximumReadLines
  if (!Number.isSafeInteger(offset) || offset < 1) return { ok: false, error: "invalid-offset" }
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    return { ok: false, error: "invalid-limit" }
  }
  const limit = Math.min(requestedLimit, limits.maximumReadLines)
  const lines = Match.value(content.length === 0).pipe(
    Match.when(true, () => [] as Array<string>),
    Match.when(false, () => content.split("\n")),
    Match.exhaustive,
  )
  if (content.endsWith("\n")) lines.pop()
  if (offset > lines.length && lines.length > 0) {
    return { ok: false, error: "offset-out-of-bounds" }
  }
  const startIndex = offset - 1
  const selected = lines.slice(startIndex, startIndex + limit)
  const retained = completeLinesWithinBytes(selected, limits.maximumOutputBytes)
  if (selected.length > 0 && retained.length === 0) {
    return { ok: false, error: "line-size-limit" }
  }
  const endLine = Match.value(retained.length === 0).pipe(
    Match.when(true, () => offset - 1),
    Match.when(false, () => offset + retained.length - 1),
    Match.exhaustive,
  )
  const truncated = startIndex + retained.length < lines.length
  return {
    ok: true,
    content: retained.join("\n"),
    startLine: offset,
    endLine,
    totalLines: lines.length,
    truncated,
    ...Match.value(truncated).pipe(
      Match.when(true, () => ({ nextOffset: endLine + 1 })),
      Match.when(false, () => ({})),
      Match.exhaustive,
    ),
  }
}

const truncateCharacters = (value: string, limits: Limits): string =>
  value.length <= limits.maximumSearchLineCharacters
    ? value
    : `${value.slice(0, limits.maximumSearchLineCharacters)}…`

const selectedFiles = (
  files: ReadonlyMap<string, string>,
  requestedPath: string | null | undefined,
) =>
  Match.value(requestedPath).pipe(
    Match.when(undefined, () => [...files.entries()]),
    Match.when(null, () => [...files.entries()]),
    Match.when(
      (path): path is string => path !== undefined && files.has(path),
      (path) => [[path, files.get(path)!] as const],
    ),
    Match.when(Match.string, (path) => {
      const prefix = Match.value(path.endsWith("/")).pipe(
        Match.when(true, () => path),
        Match.when(false, () => `${path}/`),
        Match.exhaustive,
      )
      return [...files.entries()].filter(([candidate]) => candidate.startsWith(prefix))
    }),
    Match.exhaustive,
  )

/** Searches allowlisted workspace text with bounded literal matches and context. */
export const search = (
  files: ReadonlyMap<string, string>,
  request: SearchRequest,
  limits: Limits = defaultLimits,
): SearchResult => {
  if (request.pattern.length === 0 || request.pattern.length > limits.maximumPatternCharacters) {
    return { ok: false, error: "invalid-pattern" }
  }
  const expression = Match.value(request.literal === true).pipe(
    Match.when(true, () => undefined),
    Match.when(false, () => regularExpression(request.pattern, request.ignoreCase === true)),
    Match.exhaustive,
  )
  if (request.literal !== true && expression === undefined) {
    return { ok: false, error: "invalid-pattern" }
  }
  const requestedLimit = request.limit ?? limits.maximumSearchMatches
  const requestedContext = request.context ?? 0
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    return { ok: false, error: "invalid-limit" }
  }
  if (
    !Number.isSafeInteger(requestedContext) ||
    requestedContext < 0 ||
    requestedContext > limits.maximumSearchContextLines
  ) {
    return { ok: false, error: "invalid-context" }
  }
  const candidates = selectedFiles(files, request.path).toSorted(([left], [right]) =>
    Match.value({ before: left < right, after: left > right }).pipe(
      Match.when({ before: true }, () => -1),
      Match.when({ after: true }, () => 1),
      Match.orElse(() => 0),
    ),
  )
  if (request.path != null && candidates.length === 0) {
    return { ok: false, error: "path-not-found" }
  }
  const limit = Math.min(requestedLimit, limits.maximumSearchMatches)
  const fileExpression = Match.value(request.glob).pipe(
    Match.when(undefined, () => undefined),
    Match.when(null, () => undefined),
    Match.when(Match.string, (pattern) => globExpression(pattern, limits.maximumPatternCharacters)),
    Match.exhaustive,
  )
  if (request.glob != null && fileExpression === undefined) {
    return { ok: false, error: "invalid-glob" }
  }
  const filteredCandidates = candidates.filter(
    ([path]) => fileExpression === undefined || fileExpression.test(path),
  )
  const needle = Match.value(request.ignoreCase === true).pipe(
    Match.when(true, () => request.pattern.toLowerCase()),
    Match.when(false, () => request.pattern),
    Match.exhaustive,
  )
  const matches: Array<SearchMatch> = []
  let retainedBytes = 0
  let truncated = false
  outer: for (const [path, content] of filteredCandidates) {
    const lines = content.split("\n")
    for (let index = 0; index < lines.length; index += 1) {
      const searchable = Match.value(request.ignoreCase === true).pipe(
        Match.when(true, () => lines[index]!.toLowerCase()),
        Match.when(false, () => lines[index]!),
        Match.exhaustive,
      )
      const matchesPattern = Match.value(request.literal === true).pipe(
        Match.when(true, () => searchable.includes(needle)),
        Match.when(false, () => expression!.test(lines[index]!)),
        Match.exhaustive,
      )
      if (!matchesPattern) continue
      if (matches.length >= limit) {
        truncated = true
        break outer
      }
      const first = Math.max(0, index - requestedContext)
      const last = Math.min(lines.length - 1, index + requestedContext)
      const rendered = lines
        .slice(first, last + 1)
        .map(
          (line, relativeIndex) =>
            `${first + relativeIndex + 1}: ${truncateCharacters(line, limits)}`,
        )
        .join("\n")
      const match = {
        path,
        line: index + 1,
        content: rendered,
      } satisfies SearchMatch
      const matchBytes = utf8Bytes(JSON.stringify(match))
      if (retainedBytes + matchBytes > limits.maximumOutputBytes) {
        truncated = true
        break outer
      }
      matches.push(match)
      retainedBytes += matchBytes
    }
  }
  return {
    ok: true,
    matches,
    truncated,
    searchedFiles: filteredCandidates.length,
  }
}

/** Applies unique, non-overlapping exact replacements against one original virtual file. */
export const edit = (
  content: string,
  request: EditRequest,
  limits: Limits = defaultLimits,
): EditResult => {
  const edits = editReplacements(request)
  if (edits.length < 1 || edits.length > limits.maximumEdits) {
    return { ok: false, error: "invalid-edit-count" }
  }
  const located: Array<{
    readonly start: number
    readonly end: number
    readonly newText: string
  }> = []
  for (const replacement of edits) {
    if (replacement.oldText.length === 0) return { ok: false, error: "empty-old-text" }
    const start = content.indexOf(replacement.oldText)
    if (start === -1) return { ok: false, error: "old-text-not-found" }
    if (content.indexOf(replacement.oldText, start + replacement.oldText.length) !== -1) {
      return { ok: false, error: "old-text-not-unique" }
    }
    located.push({
      start,
      end: start + replacement.oldText.length,
      newText: replacement.newText,
    })
  }
  const ordered = located.toSorted((left, right) => left.start - right.start)
  if (ordered.some((entry, index) => index > 0 && entry.start < ordered[index - 1]!.end)) {
    return { ok: false, error: "overlapping-edits" }
  }
  let updated = content
  for (const replacement of ordered.toReversed()) {
    updated = `${updated.slice(0, replacement.start)}${replacement.newText}${updated.slice(replacement.end)}`
  }
  return { ok: true, content: updated, replacements: ordered.length }
}
