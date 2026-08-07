import { existsSync, readdirSync } from "node:fs"

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

export default defineConfig({
  test: {
    // Catalog tests scan the complete pinned Expo worktree. Keep this above
    // Vitest's unit-test default so a busy CI host does not create false
    // failures while process-level hang tests retain their own tight bounds.
    testTimeout: 60_000,
    pool: "threads",
    include: [
      "tooling/**/{src,test}/**/*.test.ts",
      "tooling/dx-evals/evals/{synthetic,network,battery,keep-awake}.eval.ts",
      "packages/**/{src,test}/**/*.test.ts",
      "apps/**/{src,test}/**/*.test.ts",
    ],
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
