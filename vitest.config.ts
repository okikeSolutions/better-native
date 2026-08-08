import { existsSync, readdirSync } from "node:fs"
import { availableParallelism } from "node:os"

import { defineConfig } from "vitest/config"

const productThresholds = {
  statements: 95,
  branches: 90,
  functions: 95,
  lines: 95,
} as const

const packageThresholds = Object.fromEntries(
  readdirSync(new URL("./packages", import.meta.url), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(new URL(`./packages/${entry.name}/src`, import.meta.url)),
    )
    .map((entry) => [`packages/${entry.name}/src/**/*.ts`, productThresholds]),
)

const maxWorkers = Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2)))

const coverageEnabled = process.argv.includes("--coverage")

export default defineConfig({
  test: {
    // Catalog tests scan the complete pinned Expo worktree. Keep this above
    // Vitest's unit-test default so a busy CI host does not create false
    // failures while process-level hang tests retain their own tight bounds.
    testTimeout: 60_000,
    pool: "threads",
    // Compiler, Podman, Metro, and repository-integration tests are CPU and
    // memory intensive. Leave half the machine to child processes and cap the
    // host suite at the measured four-worker Podman concurrency ceiling.
    maxWorkers,
    include: [
      "tooling/**/{src,test}/**/*.test.ts",
      "packages/**/{src,test}/**/*.test.ts",
      "apps/**/{src,test}/**/*.test.ts",
      // The ordinary host suite stays separate from process-heavy eval controls. Coverage still
      // executes those controls because they exercise the DX controller's public harness paths.
      ...(coverageEnabled
        ? ["tooling/dx-evals/evals/{synthetic,network,battery,keep-awake,secure-store}.eval.ts"]
        : []),
    ],
    experimental: {
      // Migration work repeatedly exercises a small test slice with a large
      // Effect module graph. Persist transforms between those invocations.
      fsModuleCache: true,
    },
    sequence: {
      concurrent: false,
    },
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: ".artifacts/coverage/vitest",
      include: [
        "packages/*/src/**/*.ts",
        "apps/compatibility-suite/src/Registry.ts",
        "apps/compatibility-suite/src/Runner.ts",
        "tooling/compatibility-harness/src/**/*.ts",
        "tooling/dx-evals/src/**/*.ts",
        "tooling/dx-evals/runner/CompileDiagnostics.ts",
      ],
      exclude: ["**/*.test.ts"],
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
