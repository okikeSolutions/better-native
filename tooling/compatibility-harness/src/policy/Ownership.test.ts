import { assert, describe, it } from "@effect/vitest"
import {
  ExportName,
  PackageName,
  Subpath,
  SurfaceId,
  type Ownership,
  type SurfaceSnapshot,
} from "../Domain.ts"
import * as OwnershipModel from "./Ownership.ts"

const surface: SurfaceSnapshot = {
  schemaVersion: 1,
  expoRevision: "expo",
  catalogFingerprint: "catalog",
  fingerprint: "surface",
  exports: [
    {
      id: SurfaceId.make("expo-example#.#value"),
      package: PackageName.make("expo-example"),
      subpath: Subpath.make("."),
      name: ExportName.make("value"),
      kind: "value",
      platforms: ["android", "ios", "web"],
      declarationPaths: ["src/index.ts"],
    },
  ],
}

describe("Ownership", () => {
  it("rejects duplicate and unknown overrides", () => {
    const duplicate = {
      package: PackageName.make("expo-example"),
      subpath: Subpath.make("."),
      export: ExportName.make("value"),
      status: "effect" as const,
      replacement: "@better-native/example",
      reason: "Implemented",
      issue: "https://example.invalid/1",
    }
    const ownership: Ownership = {
      schemaVersion: 1,
      expoRevision: "expo",
      overrides: [
        duplicate,
        duplicate,
        { ...duplicate, package: PackageName.make("expo-missing") },
      ],
    }

    assert.deepEqual(OwnershipModel.issues(surface, ownership), [
      "duplicate override expo-example#.#value",
      "unknown entrypoint expo-missing.",
    ])
  })

  it("requires concrete replacements for effect-owned and fallback entrypoints", () => {
    const base = {
      package: PackageName.make("expo-example"),
      subpath: Subpath.make("."),
      export: ExportName.make("value"),
      status: "effect" as const,
      replacement: null,
      reason: "Implemented",
      issue: "https://example.invalid/1",
    }
    assert.match(
      OwnershipModel.issues(surface, {
        schemaVersion: 1,
        expoRevision: "expo",
        overrides: [base],
      }).join("\n"),
      /missing concrete replacement/,
    )
    assert.deepEqual(
      OwnershipModel.replacements({
        schemaVersion: 1,
        expoRevision: "expo",
        overrides: [{ ...base, replacement: "@better-native/example" }],
      }),
      [{ source: "expo-example", target: "@better-native/example" }],
    )
  })

  it("detects additions and disappearances against the surface lock", () => {
    assert.deepEqual(
      OwnershipModel.lockIssues(surface, {
        schemaVersion: 1,
        expoRevision: "expo",
        surfaceFingerprint: "old",
        surfaceIds: [SurfaceId.make("removed")],
      }),
      [
        "surface disappeared: removed",
        "surface added without lock update: expo-example#.#value",
        "surface fingerprint changed",
      ],
    )
  })
})
