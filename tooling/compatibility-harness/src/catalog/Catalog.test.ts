import { assert, describe, it } from "@effect/vitest"
import * as Entrypoint from "./Entrypoint.ts"
import { PackageName, Subpath } from "../Domain.ts"

describe("Entrypoint", () => {
  it("preserves conditional subpath resolution", () => {
    const entrypoints = Entrypoint.fromManifest({
      name: PackageName.make("expo-example"),
      version: "1.0.0",
      exports: {
        ".": {
          types: {
            "expo-source": "./src/index.ts",
            default: "./build/index.d.ts",
          },
          "expo-source": "./src/index.ts",
          import: "./build/mjs/index.js",
          require: "./build/cjs/index.js",
        },
        "./plugin": "./plugin/build/index.js",
      },
    })

    assert.strictEqual(entrypoints.length, 2)
    assert.strictEqual(entrypoints[0]?.subpath, Subpath.make("."))
    assert.strictEqual(entrypoints[0]?.resolutionBranches.length, 5)
    assert.deepEqual(entrypoints[0]?.resolutionBranches[0], {
      conditions: ["types", "expo-source"],
      fallback: [],
      target: "./src/index.ts",
      platforms: ["android", "ios", "macos", "server", "tvos", "web"],
    })
    assert.strictEqual(entrypoints[1]?.kind, "build-time")
  })

  it("keeps manifest resolution open without inventing explicit exports", () => {
    const entrypoints = Entrypoint.fromManifest({
      name: PackageName.make("expo-network"),
      version: "1.0.0",
      main: "build/Network.js",
      types: "build/Network.d.ts",
    })

    assert.strictEqual(entrypoints.length, 2)
    assert.strictEqual(entrypoints[0]?.resolution.source, "manifest")
    assert.ok(
      entrypoints[0]!.resolutionBranches.some((branch) => branch.target === "build/Network.d.ts"),
    )
    assert.strictEqual(entrypoints[1]?.kind, "metadata")
  })
})
