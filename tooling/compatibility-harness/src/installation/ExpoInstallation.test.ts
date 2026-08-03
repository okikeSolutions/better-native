import { assert, describe, it } from "@effect/vitest"
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
      ExpoInstallation.statusOf({ ...base, installedVersion: "56.0.0" }),
      "version-mismatch",
    )
    assert.strictEqual(ExpoInstallation.statusOf({ ...base, resolution: null }), "unlocked")
    assert.strictEqual(ExpoInstallation.statusOf({ ...base, installedVersion: null }), "missing")
  })
})
