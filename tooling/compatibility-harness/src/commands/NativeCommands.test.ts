import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { BuildId, ContentHash, type BuildRecord } from "../Domain.ts"
import { validateCapabilityShell } from "./NativeCommands.ts"

const hash = ContentHash.make("0".repeat(64))
const sourceId = "better-native-capability#apps/compatibility-suite/src/capabilities/Location.ts"
const record = (capabilitySource: string | null): BuildRecord => ({
  schemaVersion: 2,
  id: BuildId.make("scoped-native-build"),
  mode: "candidate",
  platform: "ios",
  expoRevision: "expo-revision",
  candidateRevision: "candidate-revision",
  capabilitySource,
  configurationHash: hash,
  bundleHash: hash,
  nativeBinaryHash: hash,
  nativeFingerprint: "native-fingerprint",
  toolchainFingerprint: hash,
  buildDecision: "repack",
  nativeArtifact: null,
  performance: { architecture: "test", phases: [], caches: [] },
  artifacts: [],
})

describe("capability-scoped native shell validation", () => {
  it.effect("allows the full-suite shell to execute any selected source", () =>
    validateCapabilityShell(record(null), sourceId),
  )

  it.effect("allows the exact source compiled into a scoped shell", () =>
    validateCapabilityShell(record(sourceId), sourceId),
  )

  it.effect("rejects a missing or different source for a scoped shell", () =>
    Effect.gen(function* () {
      const missing = yield* Effect.flip(validateCapabilityShell(record(sourceId), undefined))
      assert.match(String(missing.cause), /pass --source/)
      const mismatch = yield* Effect.flip(
        validateCapabilityShell(record(sourceId), "better-native-capability#different"),
      )
      assert.match(String(mismatch.cause), /not better-native-capability#different/)
    }),
  )
})
