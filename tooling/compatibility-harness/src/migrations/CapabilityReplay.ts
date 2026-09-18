import { relative } from "node:path"
import type { Capability } from "./CapabilityMigrations.ts"
import {
  loadComparisonEvidenceRecords,
  readCapabilityProfileEvidence,
  sourceIdFor,
  type CapabilityProfileEvidence,
} from "./CapabilityEvidence.ts"

export interface IntegrationReplayInput {
  readonly repositoryRoot: string
  readonly evidenceRoot: string
  readonly capabilities: ReadonlyArray<Capability>
  readonly expectedExpoRevision: string
  readonly expectedCandidateRevision?: string
  readonly capabilityIds?: ReadonlyArray<string>
}

export interface IntegrationReplay {
  readonly candidateRevision: string
  readonly expoRevision: string
  readonly capabilities: ReadonlyArray<CapabilityProfileEvidence>
  readonly recordCount: number
}

const singleValue = (label: string, values: ReadonlyArray<string>): string => {
  const distinct = [...new Set(values)]
  if (distinct.length !== 1) {
    throw new Error(
      distinct.length === 0
        ? `Replay contains no ${label}.`
        : `Replay mixes ${label}: ${distinct.join(", ")}.`,
    )
  }
  return distinct[0] as string
}

const integrationDeviceKind = (platform: "web" | "ios" | "android") => {
  if (platform === "web") return "browser"
  if (platform === "ios") return "simulator"
  return "emulator"
}

const isIntegrationPlatform = (platform: string): platform is "web" | "ios" | "android" =>
  platform === "web" || platform === "ios" || platform === "android"

/** Evaluates an immutable integration bundle without running builds, devices, or host checks. */
export const replayIntegrationEvidence = (input: IntegrationReplayInput): IntegrationReplay => {
  const loaded = loadComparisonEvidenceRecords(input.evidenceRoot)
  const malformed = loaded.filter(({ record }) => record === undefined)
  if (malformed.length > 0) {
    throw new Error(
      `Replay contains malformed comparison records: ${malformed
        .map(({ path, error }) => `${relative(input.repositoryRoot, path)} (${error ?? "invalid"})`)
        .join(", ")}.`,
    )
  }
  const records = loaded.flatMap(({ record }) => (record === undefined ? [] : [record]))
  if (records.length === 0) throw new Error("Replay contains no comparison records.")

  for (const record of records) {
    if (!isIntegrationPlatform(record.platform)) {
      throw new Error(
        `Integration replay accepts only web, iOS, and Android records; found ${record.platform}.`,
      )
    }
    const expectedKind = integrationDeviceKind(record.platform)
    if (record.device.platform !== record.platform || record.device.kind !== expectedKind) {
      throw new Error(
        `Integration replay accepts only web/browser, ios/simulator, and android/emulator records; found ${record.platform}/${record.device.kind}.`,
      )
    }
  }

  const candidateRevision = singleValue(
    "candidate revisions",
    records.map((record) => record.candidateRevision),
  )
  const expoRevision = singleValue(
    "Expo revisions",
    records.map((record) => record.expoRevision),
  )
  if (
    input.expectedCandidateRevision !== undefined &&
    candidateRevision !== input.expectedCandidateRevision
  ) {
    throw new Error(
      `Replay candidate ${candidateRevision} does not match workflow run head ${input.expectedCandidateRevision}.`,
    )
  }
  if (expoRevision !== input.expectedExpoRevision) {
    throw new Error(
      `Replay targets Expo ${expoRevision}, but the current ledger pins ${input.expectedExpoRevision}.`,
    )
  }

  const sourceToCapability = new Map(
    input.capabilities.flatMap((capability) =>
      capability.verification.parityPlatforms.map(
        (platform) => [sourceIdFor(capability, platform), capability] as const,
      ),
    ),
  )
  const recordedSources = new Set<string>(records.flatMap(({ sourceIds }) => sourceIds.map(String)))
  const unknownSources = [...recordedSources].filter(
    (sourceId) => !sourceToCapability.has(sourceId),
  )
  if (unknownSources.length > 0) {
    throw new Error(
      `Replay contains capability sources absent from the ledger: ${unknownSources.join(", ")}.`,
    )
  }

  const selected =
    input.capabilityIds === undefined
      ? input.capabilities.filter((capability) =>
          capability.verification.parityPlatforms.some((platform) =>
            recordedSources.has(sourceIdFor(capability, platform)),
          ),
        )
      : input.capabilityIds.map((id) => {
          const capability = input.capabilities.find((candidate) => candidate.id === id)
          if (capability === undefined) throw new Error(`Unknown capability ${JSON.stringify(id)}.`)
          return capability
        })

  if (selected.length === 0) throw new Error("Replay does not select any capabilities.")
  const capabilities = selected.map((capability) =>
    readCapabilityProfileEvidence(
      {
        repositoryRoot: input.repositoryRoot,
        evidenceRoot: input.evidenceRoot,
        candidateRevision,
        expoRevision,
      },
      capability,
      "integration",
    ),
  )
  return { candidateRevision, expoRevision, capabilities, recordCount: records.length }
}
