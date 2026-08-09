import { assert, describe, it } from "@effect/vitest"
import {
  androidArchitecturesFor,
  applyBuildProfile,
  buildProfileEnvironment,
} from "./BuildProfile.ts"

const spec = { command: "tool", args: ["build"], timeoutMillis: 1_000 }

describe("BuildProfile", () => {
  it("keeps CI performance commands uncapped", () => {
    assert.strictEqual(applyBuildProfile("performance", "gradle", spec), spec)
    assert.deepStrictEqual(buildProfileEnvironment("performance"), {
      BETTER_NATIVE_METRO_MAX_WORKERS: undefined,
    })
    assert.strictEqual(androidArchitecturesFor("performance"), null)
  })

  it("caps every local build tool and selects Darwin background scheduling", () => {
    assert.deepStrictEqual(applyBuildProfile("polite", "gradle", spec), {
      ...spec,
      args: ["build", "--max-workers=2", "--priority=low", "-PreactNativeArchitectures=arm64-v8a"],
      darwinScheduling: "utility-background",
    })
    assert.deepStrictEqual(applyBuildProfile("polite", "xcode", spec), {
      ...spec,
      args: ["-jobs", "2", "build"],
      darwinScheduling: "utility-background",
    })
    assert.deepStrictEqual(applyBuildProfile("polite", "metro", spec), {
      ...spec,
      args: ["build", "--max-workers", "2"],
      darwinScheduling: "utility-background",
    })
    assert.deepStrictEqual(applyBuildProfile("polite", "cocoapods", spec), {
      ...spec,
      args: ["build"],
      darwinScheduling: "utility-background",
    })
    assert.deepStrictEqual(buildProfileEnvironment("polite"), {
      BETTER_NATIVE_METRO_MAX_WORKERS: "2",
    })
    assert.strictEqual(androidArchitecturesFor("polite"), "arm64-v8a")
  })

  it("replaces conflicting worker flags instead of accumulating them", () => {
    assert.deepStrictEqual(
      applyBuildProfile("polite", "gradle", {
        ...spec,
        args: [
          "build",
          "--max-workers",
          "8",
          "--priority=normal",
          "-PreactNativeArchitectures=x86_64,x86",
        ],
      }).args,
      ["build", "--max-workers=2", "--priority=low", "-PreactNativeArchitectures=arm64-v8a"],
    )
    assert.deepStrictEqual(
      applyBuildProfile("polite", "xcode", { ...spec, args: ["build", "-jobs", "10"] }).args,
      ["-jobs", "2", "build"],
    )
  })
})
