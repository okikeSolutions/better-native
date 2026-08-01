import { describe, expect, it } from "vitest"
import { matrixSummary, renderMatrix } from "../src/Matrix.ts"

describe("Expo capability matrix", () => {
  it("accounts for the Expo SDK candidate universe without overstating verification", () => {
    const summary = matrixSummary()

    expect(summary.catalog.discoveredPackages).toBe(132)
    expect(summary.catalog.includedPackages).toBe(92)
    expect(summary.catalog.excludedPackages).toBe(40)
    expect(summary.catalog.inventoriedPackages).toBe(1)
    expect(summary.operations.adapted).toBe(2)
    expect(summary.operations.iosApplicable).toBe(3)
    expect(summary.operations.androidApplicable).toBe(4)
    expect(summary.operations.webApplicable).toBe(3)
    expect(summary.operations.iosVerified).toBe(0)
    expect(summary.operations.androidVerified).toBe(0)
  })

  it("renders a versioned JSON protocol", () => {
    const report = JSON.parse(renderMatrix("json")) as { schemaVersion: number }

    expect(report.schemaVersion).toBe(1)
  })

  it("classifies every public manifest and uses documentation only as enrichment", () => {
    const summary = matrixSummary()
    const packages = summary.packages
    const names = packages.map((entry) => entry.name)

    expect(new Set(names).size).toBe(names.length)
    expect(packages.every((entry) => entry.version !== "unknown")).toBe(true)
    expect(
      packages.every((entry) => entry.catalogStatus === "included" || entry.exclusionReason)
    ).toBe(true)
    expect(packages.find((entry) => entry.name === "expo-app-metrics")).toMatchObject({
      catalogStatus: "included",
      catalogClassification: "bundled-undocumented",
      documentation: []
    })
    expect(packages.find((entry) => entry.name === "expo")).toMatchObject({
      catalogStatus: "included",
      catalogClassification: "documented-sdk",
      sources: { publicManifest: true, bundled: false, documented: true }
    })
    expect(packages.find((entry) => entry.name === "expo-analytics-amplitude")).toMatchObject({
      catalogStatus: "included",
      catalogClassification: "bundled-only",
      sources: { publicManifest: false, bundled: true, documented: false }
    })
    expect(summary.sourceRevision).toMatch(/^[0-9a-f]{12}$/)
  })
})
