import { availableParallelism } from "node:os"
import type { InlineConfig } from "vitest/node"

export const integrationSuites = {
  published: [
    "packages/cli/test/PackedCli.test.ts",
    "packages/metro/test/MetroIntegration.test.ts",
    "tooling/compatibility-harness/src/installation/PublishedCapabilityPackages.test.ts",
  ],
  harness: [
    "tooling/compatibility-harness/src/CompatibilityIntegration.test.ts",
    "tooling/compatibility-harness/src/registry/{RunnerPlanExecution,RunnerPlans}.test.ts",
  ],
  "compile-contracts": ["tooling/dx-evals/src/agent/compile-contracts/*.test.ts"],
  isolation: ["tooling/dx-evals/src/security/isolation/*.test.ts"],
  trials: ["tooling/dx-evals/src/trial-runner/*.test.ts"],
  "task-workspace": ["tooling/dx-evals/src/tasks/TaskWorkspace.test.ts"],
} as const

export type IntegrationSuite = keyof typeof integrationSuites

export const integrationTestIncludes = Object.values(integrationSuites).flat()

export const externalProcessCoverageExcludes = [
  "packages/*/src/{Plugin,index}.ts",
  "packages/cli/src/{bin,Cli,CommandRunner}.ts",
  "tooling/compatibility-harness/src/{cli,checkGenerated,Commands,Compatibility,Coverage}.ts",
  "tooling/compatibility-harness/src/commands/**/*.ts",
  "tooling/compatibility-harness/src/build/{AppBuildExecutor,AppBuildImporter,ExpoToolchain}.ts",
  "tooling/compatibility-harness/src/catalog/Catalog.ts",
  "tooling/compatibility-harness/src/evidence/DiscoveryPass.ts",
  "tooling/compatibility-harness/src/installation/{ExpoInstallation,RegistryPackage}.ts",
  "tooling/compatibility-harness/src/migrations/cli.ts",
  "tooling/compatibility-harness/src/policy/Expectations.ts",
  "tooling/compatibility-harness/src/registry/{RunnerPlanExecution,RunnerPlans}.ts",
  "tooling/compatibility-harness/src/runners/**/*.ts",
  "tooling/compatibility-harness/src/supervision/{PlatformDrivers,WebSupervisor}.ts",
  "tooling/dx-evals/src/{cli,Commands,Harness,TrialRunner,TrialRunnerTestSupport}.ts",
  "tooling/dx-evals/src/agent/{AgentAdapters,OpenRouterAgent,ProviderCompatibility,ReferenceCompileContract}.ts",
  "tooling/dx-evals/src/reporting/{Judges,ReportSelection,ReportSmoke}.ts",
  "tooling/dx-evals/src/security/{Isolation,IsolationTestSupport,Submission}.ts",
  "tooling/dx-evals/src/tasks/{BackgroundTask,Battery,Clipboard,KeepAwake,Location,Network,Notifications,SecureStore,Sqlite,Synthetic,TaskManager,TaskModel,TaskRegistry}.ts",
] as const

export const hostTestIncludes = [
  "tooling/**/{src,test}/**/*.test.ts",
  "packages/**/{src,test}/**/*.test.ts",
  "apps/**/{src,test}/**/*.test.ts",
] as const

export const sharedTestConfig = {
  // Catalog tests scan the complete pinned Expo worktree. Keep this above
  // Vitest's unit-test default while process-level tests retain tighter bounds.
  testTimeout: 60_000,
  pool: "threads",
  sequence: {
    concurrent: false,
  },
  experimental: {
    // Focused migration runs repeatedly load a large Effect module graph.
    fsModuleCache: true,
  },
  maxWorkers: Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2))),
} satisfies InlineConfig
