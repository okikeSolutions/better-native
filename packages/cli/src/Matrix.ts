import { ExpoCatalog } from "@effect-expo/catalog"

const percentage = (value: number, total: number): number =>
  total === 0 ? 0 : Math.round((value / total) * 100)

export const matrixSummary = () => {
  const packages = ExpoCatalog.packages
  const included = packages.filter((entry) => entry.catalogStatus === "included")
  const excluded = packages.filter((entry) => entry.catalogStatus === "excluded")
  const classified = packages.filter((entry) => entry.classification !== "unclassified")
  const inventoried = packages.filter((entry) => entry.operations.length > 0)
  const operations = packages.flatMap((entry) => [...entry.operations])
  const effectEligible = operations.filter((operation) => operation.kind !== "react-hook")
  const adapted = effectEligible.filter((operation) => operation.coverage.adapter === "complete")
  const deterministic = effectEligible.filter(
    (operation) => operation.coverage.scenario === "complete"
  )
  const iosApplicable = effectEligible.filter(
    (operation) => operation.coverage.ios !== "not-applicable"
  )
  const androidApplicable = effectEligible.filter(
    (operation) => operation.coverage.android !== "not-applicable"
  )
  const webApplicable = effectEligible.filter(
    (operation) => operation.coverage.web !== "not-applicable"
  )

  return {
    schemaVersion: 1,
    sdkVersion: ExpoCatalog.sdkVersion,
    expoVersion: ExpoCatalog.expoVersion,
    sourceRevision: ExpoCatalog.sourceRevision,
    catalog: {
      discoveredPackages: packages.length,
      includedPackages: included.length,
      excludedPackages: excluded.length,
      classifiedPackages: classified.length,
      inventoriedPackages: inventoried.length
    },
    operations: {
      inventoried: operations.length,
      effectEligible: effectEligible.length,
      adapted: adapted.length,
      deterministic: deterministic.length,
      iosApplicable: iosApplicable.length,
      iosVerified: iosApplicable.filter((operation) => operation.coverage.ios === "complete")
        .length,
      androidApplicable: androidApplicable.length,
      androidVerified: androidApplicable.filter(
        (operation) => operation.coverage.android === "complete"
      ).length,
      webApplicable: webApplicable.length,
      webVerified: webApplicable.filter((operation) => operation.coverage.web === "complete")
        .length,
      agentVerified: effectEligible.filter((operation) => operation.coverage.agent === "complete")
        .length
    },
    packages
  }
}

const row = (label: string, value: number, total: number): string =>
  `${label.padEnd(28)} ${String(value).padStart(3)} / ${String(total).padEnd(3)} ${String(percentage(value, total)).padStart(3)}%`

export const renderMatrix = (format: "human" | "json"): string => {
  const report = matrixSummary()
  if (format === "json") return JSON.stringify(report, null, 2)

  const operationTotal = report.operations.effectEligible
  return [
    `Expo SDK ${report.sdkVersion} capability matrix`,
    `Expo ${report.expoVersion} · ${report.sourceRevision}`,
    "",
    row("Catalog discovered", report.catalog.discoveredPackages, report.catalog.discoveredPackages),
    row("Catalog included", report.catalog.includedPackages, report.catalog.discoveredPackages),
    row("Catalog excluded", report.catalog.excludedPackages, report.catalog.discoveredPackages),
    row(
      "Packages classified",
      report.catalog.classifiedPackages,
      report.catalog.discoveredPackages
    ),
    row(
      "Packages inventoried",
      report.catalog.inventoriedPackages,
      report.catalog.discoveredPackages
    ),
    "",
    row("Effect operations adapted", report.operations.adapted, operationTotal),
    row("Deterministic scenarios", report.operations.deterministic, operationTotal),
    row("iOS native conformance", report.operations.iosVerified, report.operations.iosApplicable),
    row(
      "Android native conformance",
      report.operations.androidVerified,
      report.operations.androidApplicable
    ),
    row("Web native conformance", report.operations.webVerified, report.operations.webApplicable),
    row("Agent evaluations", report.operations.agentVerified, operationTotal),
    "",
    "Operation percentages cover inventoried packages only; package classification shows remaining catalog work."
  ].join("\n")
}
