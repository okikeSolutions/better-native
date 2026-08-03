import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Catalog tests scan the complete pinned Expo worktree. Keep this above
    // Vitest's unit-test default so a busy CI host does not create false
    // failures while process-level hang tests retain their own tight bounds.
    testTimeout: 20_000,
    include: [
      "tooling/**/{src,test}/**/*.test.ts",
      "packages/**/{src,test}/**/*.test.ts",
      "apps/**/{src,test}/**/*.test.ts",
    ],
    sequence: {
      concurrent: false,
    },
  },
})
