import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import * as Schema from "effect/Schema"
import type * as AgentLoop from "../agent/AgentLoop.ts"
import type * as AgentProfiles from "../agent/AgentProfiles.ts"
import * as ArtifactStore from "./ArtifactStore.ts"
import * as Domain from "../Domain.ts"

/** Controller-owned manifest binding a decision to all of its evaluated inputs. */
export interface EvidenceManifest {
  readonly schemaVersion: 1
  readonly runId: Domain.RunId
  readonly taskId: Domain.TaskId
  readonly taskVersion: Domain.TaskVersion
  readonly adapterId: Domain.AdapterId
  readonly instructionDigest: Domain.Sha256Digest
  readonly evaluatorBundleDigest: Domain.Sha256Digest
  readonly taskExportDigest: Domain.Sha256Digest
  readonly submissionDigest: Domain.Sha256Digest
  readonly observationDigest: Domain.Sha256Digest
  readonly gateDigest: Domain.Sha256Digest
  readonly taskSuccess: boolean
  readonly failureEvidence: ReadonlyArray<Domain.FailureEvidence>
  readonly isolationPolicy: {
    readonly image: string
    readonly timeoutMilliseconds: number
    readonly network: "none"
    readonly filesystem: "read-only"
    readonly user: "65532:65532"
  }
  readonly agentProfile?: AgentProfiles.AgentProfile
  readonly usage: Domain.UsageSummary
  readonly agentExitReason?: AgentLoop.AgentExitReason
}

/** Manifest authenticated with a runtime-private controller key. */
export interface SignedEvidence {
  readonly manifest: EvidenceManifest
  readonly algorithm: "hmac-sha256"
  readonly signature: Domain.HmacSha256Signature
  readonly digest: Domain.Sha256Digest
}

/** Controller-side evidence authentication operations. */
export interface Service {
  readonly digest: (
    value: unknown,
  ) => Effect.Effect<Domain.Sha256Digest, PlatformError.PlatformError>
  readonly seal: (
    manifest: EvidenceManifest,
  ) => Effect.Effect<SignedEvidence, PlatformError.PlatformError>
  readonly verify: (evidence: SignedEvidence) => Effect.Effect<boolean, PlatformError.PlatformError>
}

/** Effect context tag for controller-owned evidence authentication. */
export class Evidence extends Context.Service<Evidence, Service>()(
  "@better-native/dx-evals/Evidence",
) {}

/** Failure raised when authenticated evidence cannot be published atomically. */
export class EvidenceWriteFailure extends Data.TaggedError("EvidenceWriteFailure")<{
  readonly reason: string
}> {}

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  return Match.value(value).pipe(
    Match.when(Array.isArray, (entries) => `[${entries.map(canonicalize).join(",")}]`),
    Match.orElse(
      (record) =>
        `{${Object.entries(record)
          .filter(([, entry]) => entry !== undefined)
          .toSorted(([left], [right]) => left.localeCompare(right, "en-US"))
          .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
          .join(",")}}`,
    ),
  )
}

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
const fromHex = (value: string): Uint8Array =>
  Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16))
const concatenate = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const output = new Uint8Array(left.length + right.length)
  output.set(left)
  output.set(right, left.length)
  return output
}
const constantTimeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!
  }
  return difference === 0
}

const hmacSha256 = (crypto: Crypto.Crypto, key: Uint8Array, data: Uint8Array) =>
  Effect.gen(function* () {
    const blockSize = 64
    const normalizedKey =
      key.length > blockSize ? yield* crypto.digest("SHA-256", key) : key.slice()
    const paddedKey = new Uint8Array(blockSize)
    paddedKey.set(normalizedKey)
    const innerPad = paddedKey.map((byte) => byte ^ 0x36)
    const outerPad = paddedKey.map((byte) => byte ^ 0x5c)
    const inner = yield* crypto.digest("SHA-256", concatenate(innerPad, data))
    return yield* crypto.digest("SHA-256", concatenate(outerPad, inner))
  })

const makeService = (crypto: Crypto.Crypto, key: Uint8Array): Service => {
  const digest = (value: unknown) =>
    crypto
      .digest("SHA-256", encode(canonicalize(value)))
      .pipe(Effect.map((bytes) => Domain.Sha256Digest.make(toHex(bytes))))
  const sign = (manifest: EvidenceManifest) =>
    hmacSha256(crypto, key, encode(canonicalize(manifest))).pipe(
      Effect.map((bytes) => Domain.HmacSha256Signature.make(toHex(bytes))),
    )
  return {
    digest,
    seal: (manifest) =>
      Effect.all({ signature: sign(manifest), digest: digest(manifest) }).pipe(
        Effect.map(({ digest: manifestDigest, signature }) => ({
          manifest,
          algorithm: "hmac-sha256" as const,
          signature,
          digest: manifestDigest,
        })),
      ),
    verify: (evidence) =>
      Effect.all({
        expectedDigest: digest(evidence.manifest),
        expectedSignature: sign(evidence.manifest),
      }).pipe(
        Effect.map(({ expectedDigest, expectedSignature }) =>
          Match.value({
            algorithm: evidence.algorithm,
            digestMatches: evidence.digest === expectedDigest,
          }).pipe(
            Match.when({ algorithm: "hmac-sha256", digestMatches: true }, () =>
              constantTimeEqual(fromHex(expectedSignature), fromHex(evidence.signature)),
            ),
            Match.when({ algorithm: "hmac-sha256", digestMatches: false }, () => false),
            Match.exhaustive,
          ),
        ),
      ),
  }
}

/** Process-scoped evidence authenticator with an ephemeral private key. */
export const layer = Layer.effect(
  Evidence,
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const key = yield* crypto.randomBytes(32).pipe(Effect.orDie)
    return Evidence.of(makeService(crypto, key))
  }),
)

/** Deterministic evidence authenticator used by authenticity tests. */
export const layerFromKey = (key: Uint8Array) =>
  Layer.effect(
    Evidence,
    Effect.map(Crypto.Crypto, (crypto) => Evidence.of(makeService(crypto, key))),
  )

/** Atomically writes immutable authenticated evidence beneath the configured artifacts root. */
export const persist = (runId: Domain.RunId, evidence: SignedEvidence) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    if (!Schema.is(Domain.RunId)(runId)) {
      return yield* new EvidenceWriteFailure({ reason: "unsafe-run-id" })
    }
    const artifactsRoot = yield* ArtifactStore.ensureRoot
    const directory = path.join(artifactsRoot, runId)
    const target = path.join(directory, "evidence.json")
    const encoded = `${JSON.stringify(evidence, null, 2)}\n`
    if (yield* fs.exists(directory)) {
      return yield* new EvidenceWriteFailure({ reason: "run-id-already-published" })
    }
    // Non-recursive creation is the exclusive claim on this run identity. A concurrent publisher
    // cannot replace evidence after this directory has been created.
    yield* fs.makeDirectory(directory, { mode: 0o700 })
    const temporary = path.join(directory, `.evidence.${yield* crypto.randomUUIDv4}.tmp`)
    yield* fs.writeFileString(temporary, encoded)
    yield* fs.rename(temporary, target)
    return target
  }).pipe(
    Effect.mapError((cause) =>
      Match.value(cause).pipe(
        Match.when(
          (error): error is EvidenceWriteFailure => error instanceof EvidenceWriteFailure,
          (error) => error,
        ),
        Match.orElse((error) => new EvidenceWriteFailure({ reason: String(error) })),
      ),
    ),
  )
