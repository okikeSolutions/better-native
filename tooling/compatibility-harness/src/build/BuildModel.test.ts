import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { BuildId } from "../Domain.ts"
import { BuildPipelineError, ensureNativeRebuildAllowed, type BuildRequest } from "./BuildModel.ts"

const request = (allowNativeRebuild?: boolean): BuildRequest => ({
  id: BuildId.make("native-rebuild-policy"),
  mode: "candidate",
  platform: "android",
  expoRevision: "1".repeat(40),
  candidateRevision: "2".repeat(40),
  timeoutMillis: 1_000,
  ...(allowNativeRebuild === undefined ? {} : { allowNativeRebuild }),
})

describe("native rebuild policy", () => {
  it.effect("rejects silent fallback after a repack failure", () =>
    Effect.gen(function* () {
      const result = yield* ensureNativeRebuildAllowed(request(), {
        repackFailure: true,
        reason: "Expo repack failed",
      }).pipe(Effect.flip)

      assert.instanceOf(result, BuildPipelineError)
      assert.strictEqual(result.phase, "build")
      assert.match(String(result.cause), /full native build was not started/i)
      assert.match(String(result.cause), /--allow-native-rebuild/)
    }),
  )

  it.effect("permits an explicitly authorized rebuild after a repack failure", () =>
    ensureNativeRebuildAllowed(request(true), {
      repackFailure: true,
      reason: "Expo repack failed",
    }),
  )

  it.effect("permits an ordinary cache miss without rebuild authorization", () =>
    ensureNativeRebuildAllowed(request(), {
      repackFailure: false,
      reason: "cache entry is missing",
    }),
  )
})
