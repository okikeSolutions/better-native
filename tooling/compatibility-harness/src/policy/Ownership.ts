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

/**
 * Reports duplicate, stale, or incomplete ownership overrides.
 *
 * @param surface - The discovered Expo export surface.
 * @param ownership - Reviewed ownership configuration.
 * @returns Human-readable policy issues, in deterministic traversal order.
 */
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
    const permitsReplacement = requiresReplacement || override.status === "upstream"
    if (
      requiresReplacement &&
      (override.replacement === null || override.replacement.length === 0)
    ) {
      output.push(`missing concrete replacement for ${key}`)
    }
    if (!permitsReplacement && override.replacement !== null) {
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

/**
 * Converts reviewed overrides with candidate entrypoints into Metro replacement entries.
 *
 * @param ownership - Reviewed ownership configuration.
 * @returns Sorted source-to-target replacements for candidate resolution.
 */
export const replacements = (ownership: OwnershipModel) => {
  const values = new Map<string, string>()
  for (const override of ownership.overrides) {
    if (
      (override.status === "upstream" ||
        override.status === "effect" ||
        override.status === "fallback") &&
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

/**
 * Loads ownership policy and validates it against the discovered surface.
 *
 * @param surface - The current pinned Expo export surface.
 * @returns The validated ownership configuration.
 * @throws {@link HarnessError} for stale revisions or invalid overrides.
 */
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

/**
 * Materializes a complete ownership ledger, defaulting unoverridden exports upstream.
 *
 * @param surface - The discovered export denominator.
 * @param ownership - Reviewed overrides to apply.
 * @returns A versioned ledger covering every surface export.
 * @throws {@link HarnessError} when the ledger fingerprint cannot be computed.
 */
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

/**
 * Loads the reviewed surface lock used to detect catalog drift.
 *
 * @returns The lock read from the repository compatibility inputs.
 * @throws {@link HarnessError} when the lock cannot be read or decoded.
 */
export const loadSurfaceLock = Effect.fn("Ownership.loadSurfaceLock")(function* () {
  const repository = yield* ExpoRepository
  return yield* repository.readJson("compatibility/surface-lock.json", SurfaceLock)
})

/**
 * Reports additions, removals, or fingerprint changes against the surface lock.
 *
 * @param surface - The newly discovered surface.
 * @param lock - The previously reviewed surface lock.
 * @returns Drift issues that must be reviewed before generation proceeds.
 */
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
