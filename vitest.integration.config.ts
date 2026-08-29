import { defineConfig } from "vitest/config"
import { integrationSuites, integrationTestIncludes, sharedTestConfig } from "./vitest.shared.ts"

const requestedSuite = process.env.BETTER_NATIVE_INTEGRATION_SUITE
if (requestedSuite !== undefined && !(requestedSuite in integrationSuites)) {
  throw new Error(`Unknown integration suite: ${requestedSuite}`)
}
const include =
  requestedSuite === undefined
    ? integrationTestIncludes
    : integrationSuites[requestedSuite as keyof typeof integrationSuites]

export default defineConfig({
  root: import.meta.dirname,
  test: {
    ...sharedTestConfig,
    name: requestedSuite === undefined ? "integration" : `integration:${requestedSuite}`,
    include: [...include],
  },
})
