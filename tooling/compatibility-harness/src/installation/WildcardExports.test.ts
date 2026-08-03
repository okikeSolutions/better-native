import { assert, describe, it } from "@effect/vitest"
import { Subpath } from "../Domain.ts"
import * as WildcardExports from "./WildcardExports.ts"

describe("WildcardExports", () => {
  it("derives concrete public subpaths from installed files", () => {
    const expanded = WildcardExports.expand(
      {
        subpath: Subpath.make("./internal/*"),
        kind: "runtime",
        pattern: true,
        resolution: {
          source: "exports",
          value: {
            types: "./internal/*.d.ts",
            default: "./internal/*.js",
          },
        },
        resolutionBranches: [
          {
            conditions: ["types"],
            fallback: [],
            target: "./internal/*.d.ts",
            platforms: ["android", "ios", "web"],
          },
          {
            conditions: ["default"],
            fallback: [],
            target: "./internal/*.js",
            platforms: ["android", "ios", "web"],
          },
        ],
      },
      ["internal/async.d.ts", "internal/async.js", "internal/private.ts", "package.json"],
    )

    assert.deepEqual(expanded, [
      {
        declarationSource: "pinned",
        declaredSubpath: Subpath.make("./internal/*"),
        subpath: Subpath.make("./internal/async"),
        matchedFiles: ["internal/async.d.ts", "internal/async.js"],
      },
    ])
  })

  it("does not invent subpaths when an installed target is absent", () => {
    const expanded = WildcardExports.expand(
      {
        subpath: Subpath.make("./adapter/*"),
        kind: "runtime",
        pattern: true,
        resolution: { source: "exports", value: "./build/adapter/*.js" },
        resolutionBranches: [
          {
            conditions: [],
            fallback: [],
            target: "./build/adapter/*.js",
            platforms: ["android", "ios", "web"],
          },
        ],
      },
      ["src/adapter/node.ts"],
    )

    assert.deepEqual(expanded, [])
  })
})
