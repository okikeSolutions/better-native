import { readFile } from "node:fs/promises"
import { assert, describe, it } from "@effect/vitest"
import {
  externalProcessCoverageExcludes,
  integrationSuites,
  integrationTestIncludes,
} from "../../../vitest.shared.ts"

interface Ledger {
  readonly capabilities: ReadonlyArray<{
    readonly id: string
    readonly candidatePackage: string
    readonly verification: {
      readonly integrationSuites: ReadonlyArray<string>
    }
  }>
}

describe("verification lanes", () => {
  it("partitions every integration test into one named CI suite", () => {
    const flattened = Object.values(integrationSuites).flat()
    assert.deepEqual(flattened, integrationTestIncludes)
    assert.strictEqual(new Set(flattened).size, flattened.length)
    assert.ok(Object.values(integrationSuites).every((files) => files.length > 0))
  })

  it("keeps product runtime coverage exclusions narrow", () => {
    const productExclusions = externalProcessCoverageExcludes.filter((pattern) =>
      pattern.startsWith("packages/"),
    )
    assert.deepEqual(productExclusions, [
      "packages/*/src/{Plugin,index}.ts",
      "packages/cli/src/{bin,Cli,CommandRunner}.ts",
    ])
  })

  it("routes every ledger capability through package coverage and CI", async () => {
    const ledger = JSON.parse(await readFile("compatibility/capabilities.json", "utf8")) as Ledger
    const workflow = await readFile(".github/workflows/check.yml", "utf8")
    for (const capability of ledger.capabilities) {
      const packageDirectory = `packages/${capability.id}`
      const manifest = JSON.parse(await readFile(`${packageDirectory}/package.json`, "utf8")) as {
        readonly name?: string
        readonly scripts?: Readonly<Record<string, string>>
      }
      assert.strictEqual(manifest.name, capability.candidatePackage)
      assert.ok(manifest.scripts?.["test:unit"]?.includes("vitest.unit.config.ts"))
      assert.ok(manifest.scripts?.["test:coverage"]?.includes("vitest.coverage.config.ts"))
      assert.ok(capability.verification.integrationSuites.includes("published"))
    }
    assert.match(workflow, /\[\.capabilities\[\]\.id\]/)
    assert.match(workflow, /fromJSON\(needs\.plan\.outputs\.capabilities\)/)
    assert.match(workflow, /name: Verification required/)
  })
})
