import { describe, expect, it } from "@effect/vitest"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect } from "effect"
import * as FileSystem from "effect/FileSystem"
import { CapabilitySpec, decodeCapabilitySpec } from "@effect-expo/core/CapabilitySpec"
import {
  checkNetworkArtifacts,
  checkNetworkOutput,
  renderNetwork,
  renderNetworkCapability
} from "../src/generator/NetworkGenerator.ts"
import {
  readGeneratedArtifact,
  writeGeneratedArtifact
} from "../src/generator/GeneratedArtifact.ts"

describe("@effect-expo/cli Network generator", () => {
  it.effect("renders the service deterministically", () =>
    Effect.gen(function* () {
      const spec = yield* decodeCapabilitySpec({
        schemaVersion: 1,
        id: "network",
        service: "Network",
        documentation: {
          summary: "Provides network state.",
          details: ["Decodes values at the native boundary."],
          category: "services",
          since: "0.1.0",
          platforms: [
            {
              name: "ios",
              behavior: "Uses expo-network."
            }
          ]
        },
        operations: [
          {
            name: "current",
            upstream: "getNetworkStateAsync",
            kind: "effect",
            platforms: ["ios"],
            success: "NetworkState",
            error: "NetworkError",
            evidence: { adapter: "complete", scenario: "complete" },
            documentation: {
              summary: "Reads the current state.",
              failures: ["Fails when native data is invalid."]
            }
          },
          {
            name: "changes",
            upstream: "addNetworkStateListener",
            kind: "stream",
            platforms: ["ios"],
            success: "NetworkState",
            error: "NetworkError",
            evidence: { adapter: "complete", scenario: "complete" },
            documentation: {
              summary: "Observes state changes.",
              failures: []
            }
          }
        ],
        native: {
          package: "expo-network",
          configPlugins: [],
          androidPermissions: ["android.permission.ACCESS_NETWORK_STATE"],
          unimplementedOperations: []
        }
      })

      const first = renderNetwork(spec)
      const second = renderNetwork(spec)

      expect(first).toBe(second)
      expect(first).toContain("readonly current: Effect.Effect<NetworkState, NetworkError>")
      expect(first).toContain("readonly changes: Stream.Stream<NetworkState, NetworkError>")
      expect(first).toContain("@category services")
      expect(first).toContain("@since 0.1.0")
      expect(first).toContain("Failure channel:")
      expect(renderNetworkCapability(spec)).toContain('"upstream": "getNetworkStateAsync"')
      expect(renderNetworkCapability(spec)).toContain('"effect": "changes"')
      expect(
        renderNetworkCapability({
          ...spec,
          operations: spec.operations.map((operation) => ({
            ...operation,
            evidence: { adapter: "missing", scenario: "unverified" } as const
          }))
        })
      ).toContain('"adapter": "missing"')

      yield* checkNetworkOutput(spec, first)
      const drift = yield* checkNetworkOutput(spec, `${first}\n// direct edit`).pipe(Effect.flip)
      expect(drift._tag).toBe("GeneratedArtifactOutOfDate")
      expect(drift.paths).toEqual(["packages/network/src/generated/Network.ts"])

      const missing = yield* checkNetworkOutput(spec, undefined).pipe(Effect.flip)
      expect(missing._tag).toBe("GeneratedArtifactOutOfDate")
      expect(missing.paths).toEqual(["packages/network/src/generated/Network.ts"])

      const allMissing = yield* checkNetworkArtifacts(spec, undefined, undefined).pipe(Effect.flip)
      expect(allMissing.paths).toEqual([
        "packages/network/src/generated/Network.ts",
        "packages/catalog/src/generated/NetworkCapability.ts"
      ])
    })
  )

  it.effect("rejects executable-looking fields", () =>
    Effect.gen(function* () {
      const result = yield* decodeCapabilitySpec({
        schemaVersion: 1,
        id: "network",
        service: "Network",
        documentation: {
          summary: "Provides network state.",
          details: [],
          category: "services",
          since: "0.1.0",
          platforms: [{ name: "web", behavior: "Uses browser APIs." }]
        },
        operations: [
          {
            name: "current",
            upstream: "getNetworkStateAsync",
            kind: "effect",
            platforms: ["web"],
            success: "NetworkState",
            error: "NetworkError",
            evidence: { adapter: "complete", scenario: "complete" },
            documentation: {
              summary: "Reads the current state.",
              failures: []
            }
          }
        ],
        native: {
          package: "expo-network",
          configPlugins: [],
          androidPermissions: [],
          unimplementedOperations: []
        },
        hook: "run-a-script"
      }).pipe(Effect.exit)

      expect(result._tag).toBe("Failure")
    })
  )

  it.effect.prop(
    "decodes every Schema-generated capability specification",
    [CapabilitySpec],
    ([spec]) =>
      Effect.gen(function* () {
        const decoded = yield* decodeCapabilitySpec(spec)
        expect(decoded).toEqual(spec)
      })
  )

  it.effect.prop(
    "rejects surplus executable fields on every valid specification",
    [CapabilitySpec],
    ([spec]) =>
      Effect.gen(function* () {
        const result = yield* decodeCapabilitySpec({ ...spec, hook: "run-a-script" }).pipe(
          Effect.exit
        )
        expect(result._tag).toBe("Failure")
      })
  )

  it.effect("rejects documentation that can terminate a generated comment", () =>
    Effect.gen(function* () {
      const spec = yield* decodeCapabilitySpec({
        schemaVersion: 1,
        id: "network",
        service: "Network",
        documentation: {
          summary: "Unsafe */ export const injected = true",
          details: [],
          category: "services",
          since: "0.1.0",
          platforms: [{ name: "web", behavior: "Uses browser APIs." }]
        },
        operations: [
          {
            name: "current",
            upstream: "getNetworkStateAsync",
            kind: "effect",
            platforms: ["web"],
            success: "NetworkState",
            error: "NetworkError",
            evidence: { adapter: "complete", scenario: "complete" },
            documentation: {
              summary: "Reads the current state.",
              failures: []
            }
          }
        ],
        native: {
          package: "expo-network",
          configPlugins: [],
          androidPermissions: [],
          unimplementedOperations: []
        }
      }).pipe(Effect.exit)

      expect(spec._tag).toBe("Failure")
    })
  )

  it.effect("rejects reserved TypeScript identifiers", () =>
    Effect.gen(function* () {
      const result = yield* decodeCapabilitySpec({
        schemaVersion: 1,
        id: "network",
        service: "class",
        documentation: {
          summary: "Provides network state.",
          details: [],
          category: "services",
          since: "0.1.0",
          platforms: [{ name: "web", behavior: "Uses browser APIs." }]
        },
        operations: [
          {
            name: "current",
            upstream: "getNetworkStateAsync",
            kind: "effect",
            platforms: ["web"],
            success: "NetworkState",
            error: "NetworkError",
            evidence: { adapter: "complete", scenario: "complete" },
            documentation: { summary: "Reads the current state.", failures: [] }
          }
        ],
        native: {
          package: "expo-network",
          configPlugins: [],
          androidPermissions: [],
          unimplementedOperations: []
        }
      }).pipe(Effect.exit)

      expect(result._tag).toBe("Failure")
    })
  )

  it.effect("writes atomically without leaked temp directories and rejects unsafe targets", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const directory = yield* fs.makeTempDirectoryScoped({ directory: "." })
        const generated = `${directory}/generated.ts`
        yield* writeGeneratedArtifact(generated, "export const safe = true\n")
        expect(yield* readGeneratedArtifact(generated)).toBe("export const safe = true\n")
        expect(
          (yield* fs.readDirectory(directory)).some((name) => name.startsWith(".effect-expo-"))
        ).toBe(false)

        const real = `${directory}/real.ts`
        const link = `${directory}/linked.ts`
        yield* fs.writeFileString(real, "do not overwrite\n")
        yield* fs.symlink("real.ts", link)
        const error = yield* writeGeneratedArtifact(link, "unsafe\n").pipe(Effect.flip)
        expect(error._tag).toBe("GeneratedArtifactSecurityError")
        expect(yield* fs.readFileString(real)).toBe("do not overwrite\n")

        const directoryTarget = `${directory}/directory.ts`
        yield* fs.makeDirectory(directoryTarget)
        const directoryError = yield* writeGeneratedArtifact(directoryTarget, "unsafe\n").pipe(
          Effect.flip
        )
        expect(directoryError._tag).toBe("GeneratedArtifactSecurityError")
      })
    ).pipe(Effect.provide(NodeServices.layer))
  )
})
