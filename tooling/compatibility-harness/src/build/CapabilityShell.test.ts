import { assert, describe, it } from "@effect/vitest"
import manifest from "../../../../apps/compatibility-suite/package.json" with { type: "json" }
import {
  capabilityShell,
  capabilityShellSourceIds,
  capabilityShells,
  scopeCapabilityManifest,
} from "./CapabilityShell.ts"

describe("CapabilityShell", () => {
  const appDependencies: Readonly<Record<string, string>> = manifest.dependencies

  it("keeps the 85-dependency app as the unscoped full-suite default", () => {
    assert.strictEqual(Object.keys(manifest.dependencies).length, 85)
    assert.isNull(capabilityShell(undefined))
  })

  it("declares small reviewed native closures for Clipboard, Location, SQLite, and Notifications", () => {
    for (const sourceId of Object.values(capabilityShellSourceIds)) {
      const shell = capabilityShell(sourceId)
      assert.isNotNull(shell)
      assert.strictEqual(shell!.sourceId, sourceId)
      assert.isBelow(shell!.dependencies.length, 20)
      assert.deepStrictEqual(
        shell!.dependencies.filter((name) => appDependencies[name] === undefined),
        [],
      )
    }
    assert.strictEqual(capabilityShells.size, 5)
  })

  it("trims the copied application manifest while leaving the monolith unchanged", () => {
    const shell = capabilityShell(capabilityShellSourceIds.sqlite)!
    const scoped = scopeCapabilityManifest(manifest, shell)
    assert.deepStrictEqual(
      Object.keys(scoped.dependencies as object).toSorted(),
      [...shell.dependencies].toSorted(),
    )
    assert.strictEqual(Object.keys(manifest.dependencies).length, 85)
  })

  it("includes only capability-specific providers and required companions", () => {
    const backgroundTask = capabilityShell(capabilityShellSourceIds.backgroundTask)!
    const clipboard = capabilityShell(capabilityShellSourceIds.clipboard)!
    const location = capabilityShell(capabilityShellSourceIds.location)!
    const sqlite = capabilityShell(capabilityShellSourceIds.sqlite)!
    const notifications = capabilityShell(capabilityShellSourceIds.notifications)!

    assert.isTrue(
      [
        "@better-native/background-task",
        "@better-native/task-manager",
        "expo-background-task",
        "expo-task-manager",
      ].every((name) => backgroundTask.dependencies.includes(name)),
    )
    assert.isTrue(backgroundTask.eager)
    assert.isTrue(
      ["@better-native/clipboard", "expo-clipboard"].every((name) =>
        clipboard.dependencies.includes(name),
      ),
    )
    assert.notInclude(clipboard.dependencies, "expo-location")
    assert.isTrue(
      ["@better-native/location", "expo-location"].every((name) =>
        location.dependencies.includes(name),
      ),
    )
    assert.notInclude(location.dependencies, "expo-sqlite")
    assert.isTrue(
      ["@better-native/sqlite", "expo-sqlite"].every((name) => sqlite.dependencies.includes(name)),
    )
    assert.notInclude(sqlite.dependencies, "expo-location")
    assert.isTrue(
      [
        "@better-native/notifications",
        "@better-native/task-manager",
        "expo-notifications",
        "expo-task-manager",
      ].every((name) => notifications.dependencies.includes(name)),
    )
  })

  it("rejects an unreviewed source instead of silently building the monolith", () => {
    assert.throws(
      () => capabilityShell("better-native-capability#unknown"),
      /no capability-scoped native shell is reviewed/,
    )
  })
})
