import { existsSync, readdirSync } from "node:fs"
import { defineConfig } from "vitest/config"
import {
  externalProcessCoverageExcludes,
  hostTestIncludes,
  integrationTestIncludes,
  sharedTestConfig,
} from "./vitest.shared.ts"

const productThresholds = {
  statements: 95,
  branches: 90,
  functions: 95,
  lines: 95,
} as const

const requestedPackage = process.env.BETTER_NATIVE_COVERAGE_PACKAGE
const packageNames = readdirSync(new URL("./packages", import.meta.url), { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(new URL(`./packages/${entry.name}/src`, import.meta.url)),
  )
  .map((entry) => entry.name)

if (requestedPackage !== undefined && !packageNames.includes(requestedPackage)) {
  throw new Error(`Unknown coverage package: ${requestedPackage}`)
}

const selectedPackageNames = requestedPackage === undefined ? packageNames : [requestedPackage]
const legacyPackageThresholds: Readonly<
  Record<string, Partial<Record<keyof typeof productThresholds, number>>>
> = {
  // Location's native watcher adapters contain defensive stream-empty callbacks that Expo's
  // subscription contract cannot trigger in a host unit test. Native parity owns that boundary.
  location: { functions: 94 },
  // Metro's remaining branches are defensive impossible states in package-name splitting; the
  // resolver's observable malformed-specifier behavior is covered by unit and integration tests.
  metro: { branches: 89 },
}
const packageThresholds = Object.fromEntries(
  selectedPackageNames.map((name) => [
    `packages/${name}/src/**/*.ts`,
    { ...productThresholds, ...legacyPackageThresholds[name] },
  ]),
)
const packageCoverageIncludes = selectedPackageNames.map((name) => `packages/${name}/src/**/*.ts`)
const reportsDirectory =
  requestedPackage === undefined
    ? ".artifacts/coverage/vitest"
    : `packages/${requestedPackage}/coverage`

export default defineConfig({
  root: import.meta.dirname,
  test: {
    ...sharedTestConfig,
    name: "coverage",
    include: [...hostTestIncludes],
    exclude: [...integrationTestIncludes],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory,
      include:
        requestedPackage === undefined
          ? [
              ...packageCoverageIncludes,
              "apps/compatibility-suite/src/Registry.ts",
              "apps/compatibility-suite/src/Runner.ts",
              "tooling/compatibility-harness/src/**/*.ts",
              "tooling/dx-evals/src/**/*.ts",
              "tooling/dx-evals/runner/CompileDiagnostics.ts",
            ]
          : packageCoverageIncludes,
      exclude: ["**/*.test.ts", ...externalProcessCoverageExcludes],
      thresholds: {
        ...packageThresholds,
        "apps/compatibility-suite/src/{Registry,Runner}.ts": {
          ...productThresholds,
        },
        "tooling/compatibility-harness/src/**/*.ts": {
          statements: 70,
          branches: 65,
          functions: 63,
          lines: 70,
        },
        "tooling/dx-evals/src/**/*.ts": {
          statements: 80,
          branches: 70,
          functions: 78,
          lines: 80,
        },
        "tooling/dx-evals/runner/CompileDiagnostics.ts": {
          statements: 100,
          branches: 77,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
})
