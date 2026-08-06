import { assert, describe, it } from "@effect/vitest"
import type { ExpoInstallation as ExpoInstallationModel } from "../Domain.ts"
import * as ExpoInstallation from "./ExpoInstallation.ts"

const base = {
  installedVersion: "57.0.1",
  expectedVersion: "~57.0.1",
  declaredVersion: "~57.0.1",
  resolution: { version: "57.0.1", integrity: "sha512-example" },
}

describe("ExpoInstallation", () => {
  it("distinguishes declaration, version, lockfile and source failures", () => {
    assert.strictEqual(ExpoInstallation.statusOf(base), "valid")
    assert.strictEqual(
      ExpoInstallation.statusOf({ ...base, declaredVersion: undefined }),
      "not-declared",
    )
    assert.strictEqual(
      ExpoInstallation.statusOf({
        ...base,
        declaredVersion: undefined,
        requiresDeclaration: false,
      }),
      "valid",
    )
    assert.strictEqual(
      ExpoInstallation.statusOf({ ...base, installedVersion: "56.0.0" }),
      "version-mismatch",
    )
    assert.strictEqual(
      ExpoInstallation.statusOf({ ...base, declaredVersion: "~56.0.0" }),
      "version-mismatch",
    )
    assert.strictEqual(ExpoInstallation.statusOf({ ...base, resolution: null }), "unlocked")
    assert.strictEqual(ExpoInstallation.statusOf({ ...base, installedVersion: null }), "missing")
  })

  it("renders blocking and non-blocking diagnostics with absent registry evidence", () => {
    // These functions consume only diagnostic report fields. The integration test constructs and
    // schema-validates the complete installation report.
    const installation = {
      expoRevision: "pinned-revision",
      packages: [
        {
          name: "expo-missing",
          status: "missing",
          declaredVersion: null,
          expectedVersion: "~1.0.0",
          registryPackage: null,
          registryMatchesPinnedRevision: false,
        },
        {
          name: "expo-invalid",
          status: "version-mismatch",
          declaredVersion: "~1.0.0",
          expectedVersion: "~1.0.0",
          registryPackage: null,
          registryMatchesPinnedRevision: null,
        },
      ],
    } as unknown as ExpoInstallationModel

    assert.deepEqual(ExpoInstallation.issues(installation), [
      "expo-missing: missing (declared nothing, expected ~1.0.0, installed nothing)",
      "expo-invalid: version-mismatch (declared ~1.0.0, expected ~1.0.0, installed nothing)",
    ])
    assert.deepEqual(ExpoInstallation.blockingIssues(installation), [
      "expo-invalid: version-mismatch (declared ~1.0.0, expected ~1.0.0, installed nothing)",
    ])
    assert.deepEqual(ExpoInstallation.registryDifferences(installation), [
      "expo-missing: registry commit unknown differs from pinned target pinned-revision",
    ])
  })
})
