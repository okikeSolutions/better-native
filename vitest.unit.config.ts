import { defineConfig } from "vitest/config"
import { hostTestIncludes, integrationTestIncludes, sharedTestConfig } from "./vitest.shared.ts"

export default defineConfig({
  root: import.meta.dirname,
  test: {
    ...sharedTestConfig,
    name: "unit",
    include: [...hostTestIncludes],
    exclude: [...integrationTestIncludes],
  },
})
