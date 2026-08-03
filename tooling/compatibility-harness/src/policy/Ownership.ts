import * as Effect from "effect/Effect"
import {
  Ownership,
  SurfaceLock,
  type Ownership as OwnershipModel,
  type OwnershipLedger as OwnershipLedgerModel,
  type OwnershipOverride,
  type SurfaceLock as SurfaceLockModel,
  type SurfaceSnapshot,
} from "../Domain.ts"
import { ExpoRepository } from "../ExpoRepository.ts"
import { HarnessError } from "../HarnessError.ts"

const keyOf = (override: OwnershipOverride): string =>
  `${override.package}#${override.subpath}#${override.export ?? "*"}`

export const issues = (
  surface: SurfaceSnapshot,
  ownership: OwnershipModel,
): ReadonlyArray<string> => {
  const byPackage = new Map<string, ReadonlyArray<SurfaceSnapshot["exports"][number]>>()
  for (const entry of surface.exports) {
    byPackage.set(entry.package, [...(byPackage.get(entry.package) ?? []), entry])
  }
  const seen = new Set<string>()
  const output: Array<string> = []
  for (const override of ownership.overrides) {
    const key = keyOf(override)
    if (seen.has(key)) output.push(`duplicate override ${key}`)
    seen.add(key)
    const matches = (byPackage.get(override.package) ?? []).filter(
      (entry) =>
        entry.subpath === override.subpath &&
        (override.export === null || entry.name === override.export),
    )
    if (matches.length === 0) {
      output.push(`unknown entrypoint ${override.package}${override.subpath}`)
    }
    if (override.reason.trim().length === 0) output.push(`missing reason for ${key}`)
    if (override.issue.trim().length === 0) output.push(`missing issue for ${key}`)
    const requiresReplacement = override.status === "effect" || override.status === "fallback"
    if (
      requiresReplacement &&
      (override.replacement === null || override.replacement.length === 0)
    ) {
      output.push(`missing concrete replacement for ${key}`)
    }
    if (!requiresReplacement && override.replacement !== null) {
      output.push(`unexpected replacement for ${key}`)
    }
  }
  const replacementBySource = new Map<string, string>()
  for (const override of ownership.overrides) {
    if (override.replacement === null) continue
    const source =
      override.subpath === "."
        ? override.package
        : `${override.package}/${override.subpath.slice(2)}`
    const previous = replacementBySource.get(source)
    if (previous !== undefined && previous !== override.replacement) {
      output.push(`conflicting concrete replacements for ${source}`)
    }
    replacementBySource.set(source, override.replacement)
  }
  return output
}

export const replacements = (ownership: OwnershipModel) => {
  const values = new Map<string, string>()
  for (const override of ownership.overrides) {
    if (
      (override.status === "effect" || override.status === "fallback") &&
      override.replacement !== null
    ) {
      const source =
        override.subpath === "."
          ? override.package
          : `${override.package}/${override.subpath.slice(2)}`
      values.set(source, override.replacement)
    }
  }
  return [...values]
    .map(([source, target]) => ({ source, target }))
    .toSorted((left, right) => left.source.localeCompare(right.source))
}

export const load = Effect.fn("Ownership.load")(function* (surface: SurfaceSnapshot) {
  const repository = yield* ExpoRepository
  const ownership = yield* repository.readJson("compatibility/ownership.json", Ownership)
  if (ownership.expoRevision !== surface.expoRevision) {
    return yield* new HarnessError({
      operation: "validate ownership revision",
      path: "compatibility/ownership.json",
      cause: `found ${ownership.expoRevision}; expected ${surface.expoRevision}`,
    })
  }

  const [issue] = issues(surface, ownership)
  if (issue !== undefined) {
    return yield* new HarnessError({
      operation: "validate ownership override",
      path: "compatibility/ownership.json",
      cause: issue,
    })
  }
  return ownership
})

export const materialize = Effect.fn("Ownership.materialize")(function* (
  surface: SurfaceSnapshot,
  ownership: OwnershipModel,
) {
  const repository = yield* ExpoRepository
  const entries = surface.exports.map((entry) => {
    const override = ownership.overrides.find(
      (candidate) =>
        candidate.package === entry.package &&
        candidate.subpath === entry.subpath &&
        (candidate.export === null || candidate.export === entry.name),
    )
    return override === undefined
      ? { surfaceId: entry.id, owner: "upstream" as const, reason: null, issue: null }
      : {
          surfaceId: entry.id,
          owner: override.status,
          reason: override.reason,
          issue: override.issue,
        }
  })
  return {
    schemaVersion: 1,
    expoRevision: surface.expoRevision,
    surfaceFingerprint: surface.fingerprint,
    fingerprint: yield* repository.hashString(JSON.stringify(entries)),
    entries,
  } satisfies OwnershipLedgerModel
})

export const loadSurfaceLock = Effect.fn("Ownership.loadSurfaceLock")(function* () {
  const repository = yield* ExpoRepository
  return yield* repository.readJson("compatibility/surface-lock.json", SurfaceLock)
})

export const lockIssues = (
  surface: SurfaceSnapshot,
  lock: SurfaceLockModel,
): ReadonlyArray<string> => {
  if (lock.expoRevision !== surface.expoRevision) return ["surface lock Expo revision is stale"]
  const expected = new Set(lock.surfaceIds)
  const actual = new Set(surface.exports.map((entry) => entry.id))
  const missing = [...expected].filter((id) => !actual.has(id))
  const added = [...actual].filter((id) => !expected.has(id))
  return [
    ...missing.map((id) => `surface disappeared: ${id}`),
    ...added.map((id) => `surface added without lock update: ${id}`),
    ...(lock.surfaceFingerprint === surface.fingerprint ? [] : ["surface fingerprint changed"]),
  ]
}
