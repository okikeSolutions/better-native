import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Fiber from "effect/Fiber"
import * as TestClock from "effect/testing/TestClock"
import { provideLayer } from "../TestLayers.ts"
import { ArtifactLifecycle, failedWorkspaceRetentionMillis, layer } from "./ArtifactLifecycle.ts"

describe("ArtifactLifecycle", () => {
  it.effect("serializes native compilers across independent service layers", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-native-lock-" })
      const lock = `${root}/machine-native-build.lock`
      const firstAcquired = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      const secondAcquired = yield* Deferred.make<void>()
      const lockLayer = () => layer(root, { nativeBuildLockPath: lock, nativeBuildPollMillis: 10 })

      const first = yield* Effect.gen(function* () {
        const lifecycle = yield* ArtifactLifecycle
        yield* lifecycle.acquireNativeBuild("ios:first")
        yield* Deferred.succeed(firstAcquired, undefined)
        yield* Deferred.await(releaseFirst)
      }).pipe(Effect.scoped, provideLayer(lockLayer()), Effect.forkChild)
      yield* Deferred.await(firstAcquired)

      const second = yield* Effect.gen(function* () {
        const lifecycle = yield* ArtifactLifecycle
        yield* lifecycle.acquireNativeBuild("android:second")
        yield* Deferred.succeed(secondAcquired, undefined)
      }).pipe(Effect.scoped, provideLayer(lockLayer()), Effect.forkChild)
      yield* Effect.yieldNow
      assert.isFalse(yield* Deferred.isDone(secondAcquired))

      yield* Deferred.succeed(releaseFirst, undefined)
      yield* Fiber.join(first)
      yield* TestClock.adjust(10)
      yield* Deferred.await(secondAcquired)
      yield* Fiber.join(second)
      assert.isFalse(yield* fs.exists(lock))
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("atomically recovers a native build lock left by a dead process", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-native-stale-" })
      const lock = `${root}/machine-native-build.lock`
      yield* fs.makeDirectory(lock, { recursive: true })
      yield* fs.writeFileString(
        `${lock}/owner.json`,
        `${JSON.stringify({
          schemaVersion: 1,
          pid: Number.MAX_SAFE_INTEGER,
          label: "dead-build",
          startedAtMillis: 0,
          token: "dead-token",
        })}\n`,
      )
      yield* Effect.gen(function* () {
        const lifecycle = yield* ArtifactLifecycle
        yield* lifecycle.acquireNativeBuild("ios:replacement")
        const owner = JSON.parse(yield* fs.readFileString(`${lock}/owner.json`)) as {
          readonly label: string
          readonly token: string
        }
        assert.strictEqual(owner.label, "ios:replacement")
        assert.notStrictEqual(owner.token, "dead-token")
      }).pipe(
        Effect.scoped,
        provideLayer(layer(root, { nativeBuildLockPath: lock, nativeBuildPollMillis: 10 })),
      )
      assert.isFalse(yield* fs.exists(lock))
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("keeps active workspaces and every cache entry protected", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-lifecycle-active-" })
      const workspace = `${root}/.artifacts/workspaces/ios-upstream`
      const cache = `${root}/.artifacts/pods-cache/v1/cache-a`
      yield* fs.makeDirectory(workspace, { recursive: true })
      yield* fs.makeDirectory(cache, { recursive: true })
      yield* fs.writeFileString(`${cache}/data`, "cache")
      const report = yield* Effect.gen(function* () {
        const lifecycle = yield* ArtifactLifecycle
        yield* lifecycle.acquireWorkspace(workspace)
        return yield* lifecycle.prune({ dryRun: true, cacheBudgetBytes: 0 })
      }).pipe(provideLayer(layer(root)))
      assert.isTrue(
        report.entries.some(({ path, decision }) => path === workspace && decision === "protect"),
      )
      assert.isTrue(
        report.entries.some(({ path, decision }) => path === cache && decision === "protect"),
      )
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("protects a newly created lock while its owner record is initializing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-lifecycle-race-" })
      const workspace = `${root}/.artifacts/workspaces/ios-upstream`
      const lock = `${root}/.artifacts/locks/workspaces/ios-upstream`
      yield* fs.makeDirectory(workspace, { recursive: true })
      yield* fs.makeDirectory(lock, { recursive: true })
      const result = yield* Effect.gen(function* () {
        const lifecycle = yield* ArtifactLifecycle
        const report = yield* lifecycle.prune({ dryRun: false, cacheBudgetBytes: 0 })
        const acquire = yield* Effect.exit(lifecycle.acquireWorkspace(workspace))
        const clean = yield* Effect.exit(lifecycle.cleanAll)
        return { acquire, clean, report }
      }).pipe(provideLayer(layer(root)))
      assert.strictEqual(
        result.report.entries.find(({ path }) => path === lock)?.decision,
        "protect",
      )
      assert.strictEqual(result.acquire._tag, "Failure")
      assert.strictEqual(result.clean._tag, "Failure")
      assert.isTrue(yield* fs.exists(workspace))
      assert.isTrue(yield* fs.exists(lock))
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("retains only the newest failed workspace for 24 hours", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-lifecycle-failure-" })
      const older = `${root}/.artifacts/workspaces/ios-upstream`
      const newer = `${root}/.artifacts/workspaces/ios-candidate`
      yield* fs.makeDirectory(older, { recursive: true })
      yield* fs.makeDirectory(newer, { recursive: true })
      const now = Date.now()
      yield* fs.utimes(older, new Date(now - 1_000), new Date(now - 1_000))
      yield* fs.utimes(newer, new Date(now), new Date(now))
      const report = yield* Effect.gen(function* () {
        const lifecycle = yield* ArtifactLifecycle
        return yield* lifecycle.prune({ dryRun: true, nowMillis: now })
      }).pipe(provideLayer(layer(root)))
      const decisions = new Map(report.entries.map((entry) => [entry.path, entry]))
      assert.strictEqual(decisions.get(older)?.decision, "delete")
      assert.strictEqual(decisions.get(newer)?.decision, "keep")

      const expired = yield* Effect.gen(function* () {
        const lifecycle = yield* ArtifactLifecycle
        return yield* lifecycle.prune({
          dryRun: true,
          nowMillis: now + failedWorkspaceRetentionMillis + 1,
        })
      }).pipe(provideLayer(layer(root)))
      assert.strictEqual(expired.entries.find(({ path }) => path === newer)?.decision, "delete")
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("uses the same deterministic LRU targets for dry-run and deletion", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-lifecycle-lru-" })
      const cacheRoot = `${root}/.artifacts/native-cache/v1`
      const now = Date.now()
      for (const [index, name] of ["old", "middle", "new"].entries()) {
        const entry = `${cacheRoot}/${name}`
        yield* fs.makeDirectory(entry, { recursive: true })
        yield* fs.writeFile(`${entry}/binary`, new Uint8Array(8_192))
        yield* fs.utimes(entry, new Date(now + index), new Date(now + index))
      }
      const dryRun = yield* Effect.gen(function* () {
        const lifecycle = yield* ArtifactLifecycle
        return yield* lifecycle.prune({ dryRun: true, cacheBudgetBytes: 1, nowMillis: now + 10 })
      }).pipe(provideLayer(layer(root)))
      const applied = yield* Effect.gen(function* () {
        const lifecycle = yield* ArtifactLifecycle
        return yield* lifecycle.prune({ dryRun: false, cacheBudgetBytes: 1, nowMillis: now + 10 })
      }).pipe(provideLayer(layer(root)))
      const selected = (report: typeof dryRun) =>
        report.entries.filter(({ decision }) => decision === "delete").map(({ path }) => path)
      assert.deepStrictEqual(selected(applied), selected(dryRun))
      for (const target of selected(dryRun)) assert.isFalse(yield* fs.exists(target))
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("does not count sparse logical capacity as allocated cache bytes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-lifecycle-sparse-" })
      const entry = `${root}/.artifacts/native-cache/v1/sparse`
      yield* fs.makeDirectory(entry, { recursive: true })
      yield* fs.writeFileString(`${entry}/placeholder`, "")
      yield* fs.truncate(`${entry}/placeholder`, 1024 ** 3)
      const report = yield* Effect.gen(function* () {
        const lifecycle = yield* ArtifactLifecycle
        return yield* lifecycle.prune({ dryRun: true })
      }).pipe(provideLayer(layer(root)))
      assert.isBelow(report.cacheBytesBefore, 1024 ** 2)
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("refuses to traverse a linked artifact root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-lifecycle-link-" })
      const outside = yield* fs.makeTempDirectoryScoped({
        prefix: "better-native-lifecycle-outside-",
      })
      yield* fs.writeFileString(`${outside}/keep.txt`, "keep")
      yield* fs.symlink(outside, `${root}/.artifacts`)
      const report = yield* Effect.gen(function* () {
        const lifecycle = yield* ArtifactLifecycle
        return yield* lifecycle.prune({ dryRun: false, cacheBudgetBytes: 0 })
      }).pipe(provideLayer(layer(root)))
      assert.deepStrictEqual(
        report.entries.map(({ decision, reason }) => ({ decision, reason })),
        [{ decision: "protect", reason: "linked artifact root is never traversed" }],
      )
      assert.strictEqual(yield* fs.readFileString(`${outside}/keep.txt`), "keep")
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )

  it.effect("publishes a native product before removing its workspace", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "better-native-lifecycle-publish-" })
      const workspace = `${root}/.artifacts/workspaces/ios-upstream`
      const source = `${workspace}/derived-data/BetterNativeCompatibility.app`
      yield* fs.makeDirectory(source, { recursive: true })
      yield* fs.writeFileString(`${source}/binary`, "validated")
      const destination = yield* Effect.gen(function* () {
        const lifecycle = yield* ArtifactLifecycle
        return yield* lifecycle.publishNativeProduct({
          workspace,
          source,
          buildId: "publish-test",
          name: "BetterNativeCompatibility.app",
        })
      }).pipe(provideLayer(layer(root)))
      assert.strictEqual(yield* fs.readFileString(`${destination}/binary`), "validated")
      assert.isFalse(yield* fs.exists(workspace))
    }).pipe(Effect.scoped, provideLayer(NodeServices.layer)),
  )
})
