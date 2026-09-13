import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import * as Schema from "effect/Schema"
import {
  ComparisonEvidenceRecord,
  type ComparisonEvidenceRecord as ComparisonEvidenceRecordType,
} from "../Domain.ts"
import type { Capability } from "./CapabilityMigrations.ts"
import type { VerificationProfile } from "./CapabilityVerification.ts"

export type NativeEvidenceKind = "browser" | "simulator" | "emulator" | "physical"
export type EvidenceStatus = "verified" | "missing" | "stale" | "invalid"

export interface EvidenceObligation {
  readonly platform: "web" | "ios" | "android"
  readonly deviceKind: NativeEvidenceKind
  readonly status: EvidenceStatus
  readonly path?: string
  readonly detail: string
}

export interface CapabilityProfileEvidence {
  readonly profile: Exclude<VerificationProfile, "host">
  readonly sourceId: string
  readonly verified: boolean
  readonly obligations: ReadonlyArray<EvidenceObligation>
}

interface EvidenceContext {
  readonly repositoryRoot: string
  readonly candidateRevision: string
  readonly expoRevision: string
}

interface LoadedRecord {
  readonly path: string
  readonly record?: ComparisonEvidenceRecordType
  readonly raw?: unknown
  readonly error?: string
}

const sourceIdFor = (capability: Capability): string =>
  `better-native-capability#apps/compatibility-suite/src/capabilities/${capability.compatibilitySource}`

const recordFiles = (root: string): ReadonlyArray<string> => {
  if (!existsSync(root)) return []
  const files: Array<string> = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name === "record.json") files.push(path)
    }
  }
  visit(root)
  return files.toSorted()
}

const loadRecords = (context: EvidenceContext, sourceId: string): ReadonlyArray<LoadedRecord> => {
  const records: Array<LoadedRecord> = []
  for (const path of recordFiles(join(context.repositoryRoot, ".artifacts", "comparisons"))) {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(path, "utf8")) as unknown
    } catch (cause) {
      records.push({ path, error: `unreadable JSON: ${String(cause)}` })
      continue
    }
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("sourceIds" in raw) ||
      !Array.isArray(raw.sourceIds) ||
      !raw.sourceIds.includes(sourceId)
    ) {
      continue
    }
    try {
      records.push({ path, raw, record: Schema.decodeUnknownSync(ComparisonEvidenceRecord)(raw) })
    } catch (cause) {
      records.push({ path, raw, error: `invalid comparison record: ${String(cause)}` })
    }
  }
  return records
}

const expectedDeviceKind = (
  platform: Capability["verification"]["parityPlatforms"][number],
): Exclude<NativeEvidenceKind, "physical"> => {
  if (platform === "web") return "browser"
  if (platform === "ios") return "simulator"
  return "emulator"
}

/** Derives the retained differential-evidence obligations for a verification profile. */
export const obligationsFor = (
  capability: Capability,
  profile: Exclude<VerificationProfile, "host">,
): ReadonlyArray<Pick<EvidenceObligation, "platform" | "deviceKind">> => {
  const integration = capability.verification.parityPlatforms.map((platform) => ({
    platform,
    deviceKind: expectedDeviceKind(platform),
  }))
  if (profile === "integration" || !capability.requirements.physicalDevice) return integration
  return [
    ...integration,
    ...capability.verification.parityPlatforms
      .filter((platform): platform is "ios" | "android" => platform !== "web")
      .map((platform) => ({ platform, deviceKind: "physical" as const })),
  ]
}

const rawMatchesObligation = (
  raw: unknown,
  platform: EvidenceObligation["platform"],
  deviceKind: EvidenceObligation["deviceKind"],
): boolean => {
  if (typeof raw !== "object" || raw === null) return false
  const device = "device" in raw ? raw.device : undefined
  return (
    "platform" in raw &&
    raw.platform === platform &&
    typeof device === "object" &&
    device !== null &&
    "kind" in device &&
    device.kind === deviceKind
  )
}

/** Reads immutable comparison verdicts and evaluates one integration or promotion profile. */
export const readCapabilityProfileEvidence = (
  context: EvidenceContext,
  capability: Capability,
  profile: Exclude<VerificationProfile, "host">,
): CapabilityProfileEvidence => {
  const sourceId = sourceIdFor(capability)
  const records = loadRecords(context, sourceId)
  const obligations = obligationsFor(capability, profile).map(({ platform, deviceKind }) => {
    const candidates = records.filter(({ record, raw }) =>
      record === undefined
        ? rawMatchesObligation(raw, platform, deviceKind)
        : record.platform === platform && record.device.kind === deviceKind,
    )
    const verified = candidates.find(
      ({ record }) =>
        record !== undefined &&
        record.device.platform === platform &&
        record.expoRevision === context.expoRevision &&
        record.candidateRevision === context.candidateRevision &&
        record.verdict.cases > 0 &&
        record.verdict.issues.length === 0,
    )
    if (verified !== undefined) {
      return {
        platform,
        deviceKind,
        status: "verified" as const,
        path: relative(context.repositoryRoot, verified.path),
        detail: `passing comparison for Expo ${context.expoRevision} and candidate ${context.candidateRevision}`,
      }
    }
    const invalid = candidates.find(
      ({ record, error }) =>
        error !== undefined ||
        (record !== undefined &&
          (record.device.platform !== platform ||
            record.verdict.cases === 0 ||
            record.verdict.issues.length > 0)),
    )
    if (invalid !== undefined) {
      return {
        platform,
        deviceKind,
        status: "invalid" as const,
        path: relative(context.repositoryRoot, invalid.path),
        detail:
          invalid.error ??
          "comparison has inconsistent platform identity, no cases, or blocking issues",
      }
    }
    const stale = candidates.find(({ record }) => record !== undefined)
    if (stale?.record !== undefined) {
      return {
        platform,
        deviceKind,
        status: "stale" as const,
        path: relative(context.repositoryRoot, stale.path),
        detail: `record targets Expo ${stale.record.expoRevision} and candidate ${stale.record.candidateRevision}`,
      }
    }
    return {
      platform,
      deviceKind,
      status: "missing" as const,
      detail: `no retained ${platform}/${deviceKind} comparison includes ${sourceId}`,
    }
  })
  return {
    profile,
    sourceId,
    verified: obligations.every(({ status }) => status === "verified"),
    obligations,
  }
}
