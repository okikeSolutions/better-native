import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { assert, describe, it } from "@effect/vitest"
import { capabilities, capabilityNames, capabilityVersions, releaseVersion } from "../src/Model.ts"

interface Ownership {
  readonly overrides: ReadonlyArray<{
    readonly package: string
    readonly status: string
    readonly replacement: string
  }>
}

const repositoryRoot = resolve(import.meta.dirname, "../../..")

describe("CLI capability registry", () => {
  it("is derived from reviewed Effect ownership and publishable package manifests", () => {
    const ownership = JSON.parse(
      readFileSync(join(repositoryRoot, "compatibility/ownership.json"), "utf8"),
    ) as Ownership

    for (const name of capabilityNames) {
      const capability = capabilities[name]
      const reviewed = ownership.overrides.find(
        (entry) =>
          entry.package === capability.provider &&
          entry.replacement === `${capability.wrapper}/expo`,
      )
      assert.strictEqual(reviewed?.status, capability.status)
      const manifest = JSON.parse(
        readFileSync(join(repositoryRoot, "packages", name, "package.json"), "utf8"),
      ) as { version: string; private: boolean; peerDependencies: Record<string, string> }
      assert.isFalse(manifest.private)
      assert.strictEqual(manifest.version, capability.wrapperVersion)
      assert.strictEqual(manifest.version, capabilityVersions[name])
      assert.strictEqual(manifest.peerDependencies.effect, capability.effectVersion)
      assert.property(manifest.peerDependencies, capability.provider)
    }

    const cliManifest = JSON.parse(
      readFileSync(join(repositoryRoot, "packages/cli/package.json"), "utf8"),
    ) as { version: string }
    assert.strictEqual(cliManifest.version, releaseVersion)
  })
})
