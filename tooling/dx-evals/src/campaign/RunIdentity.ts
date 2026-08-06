import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import type * as PlatformError from "effect/PlatformError"
import * as Domain from "../Domain.ts"

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

/** Constructs a globally unique, bounded local campaign identity from trusted entropy. */
export const makeDefaultCampaignId = (timestamp: number, randomUuid: string): Domain.RunId =>
  Domain.RunId.make(`local-${timestamp}-${randomUuid}`)

/**
 * Derives one bounded trial identity from the complete campaign identity and a reviewed case name.
 *
 * The readable case name is retained while a 128-bit SHA-256 prefix prevents long campaign IDs
 * with a common prefix from collapsing onto the same immutable evidence directory.
 */
export const makeTrialRunId = (
  campaignId: string,
  caseName: string,
): Effect.Effect<Domain.RunId, PlatformError.PlatformError, Crypto.Crypto> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const digest = yield* crypto.digest("SHA-256", encode(`${campaignId}\0${caseName}`))
    const readableCase = caseName.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "trial"
    const identity = `${readableCase}-${toHex(digest.slice(0, 16))}`
    return Domain.RunId.make(identity)
  })
