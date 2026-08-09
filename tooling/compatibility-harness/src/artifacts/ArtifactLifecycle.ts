import * as Context from "effect/Context"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as PlatformError from "effect/PlatformError"
import * as Scope from "effect/Scope"
import { randomUUID } from "node:crypto"
import { statfs } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isSafePathSegment } from "../Domain.ts"

const gibibyte = 1024 ** 3

/** Local persistent-cache ceiling shared by CocoaPods and native binaries. */
export const defaultCacheBudgetBytes = 8 * gibibyte
/** Free-space floor that triggers pruning before a new build starts. */
export const defaultLowDiskBytes = 16 * gibibyte
/** Failed workspace retention window. */
export const failedWorkspaceRetentionMillis = 24 * 60 * 60 * 1_000
/** Bulky run-output retention window. */
export const bulkyRunRetentionMillis = 7 * 24 * 60 * 60 * 1_000
/** Grace window protecting a lock directory while its owner record is being initialized. */
export const lockInitializationGraceMillis = 60_000

export class ArtifactLifecycleError extends Data.TaggedError("ArtifactLifecycleError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

export interface ArtifactPruneEntry {
  readonly path: string
  readonly kind: "workspace" | "pods-cache" | "native-cache" | "run-output" | "lock"
  readonly decision: "delete" | "keep" | "protect"
  readonly reason: string
  readonly sizeBytes: number
  readonly lastUsedMillis: number
}

export interface ArtifactPruneReport {
  readonly dryRun: boolean
  readonly cacheBudgetBytes: number
  readonly cacheBytesBefore: number
  readonly cacheBytesAfter: number
  readonly reclaimedBytes: number
  readonly entries: ReadonlyArray<ArtifactPruneEntry>
}

export interface PruneOptions {
  readonly dryRun: boolean
  readonly cacheBudgetBytes?: number
  readonly nowMillis?: number
}

interface WorkspaceOwner {
  readonly schemaVersion: 1
  readonly pid: number
  readonly workspace: string
  readonly startedAtMillis: number
  readonly token: string
}

interface NativeBuildOwner {
  readonly schemaVersion: 1
  readonly pid: number
  readonly label: string
  readonly startedAtMillis: number
  readonly token: string
}

export interface ArtifactLifecycleOptions {
  readonly nativeBuildLockPath?: string
  readonly nativeBuildPollMillis?: number
}

interface Service {
  readonly acquireWorkspace: (
    workspace: string,
  ) => Effect.Effect<void, ArtifactLifecycleError, Scope.Scope>
  readonly acquireNativeBuild: (
    label: string,
  ) => Effect.Effect<void, ArtifactLifecycleError, Scope.Scope>
  readonly prune: (
    options: PruneOptions,
  ) => Effect.Effect<ArtifactPruneReport, ArtifactLifecycleError>
  readonly pruneBeforeBuild: Effect.Effect<ArtifactPruneReport | null, ArtifactLifecycleError>
  readonly cleanAll: Effect.Effect<ArtifactPruneReport, ArtifactLifecycleError>
  readonly publishNativeProduct: (input: {
    readonly workspace: string
    readonly source: string
    readonly buildId: string
    readonly name: string
  }) => Effect.Effect<string, ArtifactLifecycleError>
}

/** Effect service owning local artifact locks, retention, and cache budgets. */
export class ArtifactLifecycle extends Context.Service<ArtifactLifecycle, Service>()(
  "@better-native/compatibility-harness/ArtifactLifecycle",
) {}

const isProcessAlive = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const modificationMillis = (info: FileSystem.File.Info): number =>
  Option.match(info.mtime, { onNone: () => 0, onSome: (value) => value.getTime() })

const allocatedBytes = (info: FileSystem.File.Info): number =>
  Option.match(info.blocks, {
    onNone: () => Number(info.size),
    onSome: (blocks) => blocks * 512,
  })

const bulkyRunOutput = (name: string): boolean =>
  /\.(?:log|png|jpe?g|webp|mp4|mov|trace|xcresult)$/i.test(name)

/**
 * Creates the local artifact lifecycle service.
 *
 * Physical allocation is measured from filesystem blocks so sparse Xcode cache
 * files do not inflate dry-run reports. Symbolic links are never traversed.
 */
export const layer = (
  root: string,
  layerOptions: ArtifactLifecycleOptions = {},
): Layer.Layer<ArtifactLifecycle, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    ArtifactLifecycle,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const artifactsRoot = path.join(root, ".artifacts")
      const locksRoot = path.join(artifactsRoot, "locks", "workspaces")
      const workspacesRoot = path.join(artifactsRoot, "workspaces")
      const nativeBuildLock =
        layerOptions.nativeBuildLockPath ??
        path.join(tmpdir(), "better-native-native-build-v1.lock")
      const nativeBuildPollMillis = layerOptions.nativeBuildPollMillis ?? 1_000

      const linkTarget = (target: string) => fs.readLink(target).pipe(Effect.option)

      const physicalSize = (target: string): Effect.Effect<number, PlatformError.PlatformError> =>
        Effect.gen(function* () {
          if (Option.isSome(yield* linkTarget(target))) return 0
          const info = yield* fs.stat(target)
          if (info.type !== "Directory") return allocatedBytes(info)
          let total = allocatedBytes(info)
          for (const name of yield* fs.readDirectory(target)) {
            total += yield* physicalSize(path.join(target, name))
          }
          return total
        })

      const readOwner = (workspace: string): Effect.Effect<WorkspaceOwner | null> =>
        Effect.gen(function* () {
          const ownerPath = path.join(locksRoot, workspace, "owner.json")
          if (!(yield* fs.exists(ownerPath))) return null
          const text = yield* fs.readFileString(ownerPath)
          const parsed = yield* Effect.try({
            try: () => JSON.parse(text) as unknown,
            catch: () => null,
          })
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            (parsed as Partial<WorkspaceOwner>).schemaVersion !== 1 ||
            typeof (parsed as Partial<WorkspaceOwner>).pid !== "number" ||
            typeof (parsed as Partial<WorkspaceOwner>).workspace !== "string" ||
            typeof (parsed as Partial<WorkspaceOwner>).startedAtMillis !== "number" ||
            typeof (parsed as Partial<WorkspaceOwner>).token !== "string"
          ) {
            return null
          }
          return parsed as WorkspaceOwner
        }).pipe(Effect.catch(() => Effect.succeed(null)))

      const readNativeBuildOwner: Effect.Effect<NativeBuildOwner | null> = Effect.gen(function* () {
        const ownerPath = path.join(nativeBuildLock, "owner.json")
        if (!(yield* fs.exists(ownerPath))) return null
        const text = yield* fs.readFileString(ownerPath)
        const parsed = yield* Effect.try({
          try: () => JSON.parse(text) as unknown,
          catch: () => null,
        })
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          (parsed as Partial<NativeBuildOwner>).schemaVersion !== 1 ||
          typeof (parsed as Partial<NativeBuildOwner>).pid !== "number" ||
          typeof (parsed as Partial<NativeBuildOwner>).label !== "string" ||
          typeof (parsed as Partial<NativeBuildOwner>).startedAtMillis !== "number" ||
          typeof (parsed as Partial<NativeBuildOwner>).token !== "string"
        ) {
          return null
        }
        return parsed as NativeBuildOwner
      }).pipe(Effect.catch(() => Effect.succeed(null)))

      const recoverStaleNativeBuildLock = Effect.gen(function* () {
        const quarantine = `${nativeBuildLock}.stale-${randomUUID()}`
        const moved = yield* fs.rename(nativeBuildLock, quarantine).pipe(
          Effect.as(true),
          Effect.catch((cause) =>
            cause.reason._tag === "NotFound" || cause.reason._tag === "AlreadyExists"
              ? Effect.succeed(false)
              : Effect.fail(cause),
          ),
        )
        if (moved) yield* fs.remove(quarantine, { recursive: true, force: true })
        return moved
      })

      const acquireNativeBuild: Service["acquireNativeBuild"] = (label) => {
        const token = randomUUID()
        const owner: NativeBuildOwner = {
          schemaVersion: 1,
          pid: process.pid,
          label,
          startedAtMillis: Date.now(),
          token,
        }
        const attempt = Effect.gen(function* () {
          yield* fs.makeDirectory(path.dirname(nativeBuildLock), { recursive: true })
          const created = yield* fs.makeDirectory(nativeBuildLock).pipe(
            Effect.as(true),
            Effect.catch((cause) =>
              cause.reason._tag === "AlreadyExists" ? Effect.succeed(false) : Effect.fail(cause),
            ),
          )
          if (created) {
            yield* fs
              .writeFileString(
                path.join(nativeBuildLock, "owner.json"),
                `${JSON.stringify(owner)}\n`,
              )
              .pipe(
                Effect.tapError(() => fs.remove(nativeBuildLock, { recursive: true, force: true })),
              )
            return "acquired" as const
          }

          const current = yield* readNativeBuildOwner
          if (current !== null && isProcessAlive(current.pid)) return "waiting" as const
          if (current === null) {
            const info = yield* fs.stat(nativeBuildLock).pipe(Effect.option)
            if (
              Option.isSome(info) &&
              Date.now() - modificationMillis(info.value) < lockInitializationGraceMillis
            ) {
              return "waiting" as const
            }
          }
          yield* recoverStaleNativeBuildLock
          return "retry" as const
        })

        const acquire = Effect.gen(function* () {
          let waitingLogged = false
          while (true) {
            const result = yield* attempt
            if (result === "acquired") break
            if (result === "retry") continue
            if (!waitingLogged) {
              const current = yield* readNativeBuildOwner
              yield* Console.log(
                current === null
                  ? `[native-build:${label}] waiting for the machine-wide native build lock`
                  : `[native-build:${label}] waiting for ${current.label} (pid ${current.pid})`,
              )
              waitingLogged = true
            }
            yield* Effect.sleep(nativeBuildPollMillis)
          }
          yield* Console.log(`[native-build:${label}] acquired the machine-wide native build lock`)
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ArtifactLifecycleError({ operation: "acquire native build lock", cause }),
          ),
        )

        return Effect.acquireRelease(acquire, () =>
          Effect.gen(function* () {
            const current = yield* readNativeBuildOwner
            if (current?.token !== token) return
            const released = `${nativeBuildLock}.released-${token}`
            const moved = yield* fs.rename(nativeBuildLock, released).pipe(
              Effect.as(true),
              Effect.catch((cause) =>
                cause.reason._tag === "NotFound" ? Effect.succeed(false) : Effect.fail(cause),
              ),
            )
            if (moved) yield* fs.remove(released, { recursive: true, force: true })
            yield* Console.log(
              `[native-build:${label}] released the machine-wide native build lock`,
            )
          }).pipe(Effect.orDie),
        )
      }

      const acquireWorkspace: Service["acquireWorkspace"] = (workspace) => {
        const name = path.basename(workspace)
        const lock = path.join(locksRoot, name)
        const token = randomUUID()
        const acquire = Effect.gen(function* () {
          yield* fs.makeDirectory(locksRoot, { recursive: true })
          if (yield* fs.exists(lock)) {
            const owner = yield* readOwner(name)
            if (owner !== null && isProcessAlive(owner.pid)) {
              return yield* new ArtifactLifecycleError({
                operation: "acquire workspace lock",
                cause: `${workspace} is owned by active process ${owner.pid}`,
              })
            }
            if (owner === null) {
              const info = yield* fs.stat(lock)
              if (Date.now() - modificationMillis(info) < lockInitializationGraceMillis) {
                return yield* new ArtifactLifecycleError({
                  operation: "acquire workspace lock",
                  cause: `${workspace} lock owner is still initializing`,
                })
              }
            }
            yield* fs.remove(lock, { recursive: true })
          }
          yield* fs.makeDirectory(lock)
          const owner: WorkspaceOwner = {
            schemaVersion: 1,
            pid: process.pid,
            workspace: name,
            startedAtMillis: Date.now(),
            token,
          }
          yield* fs.writeFileString(path.join(lock, "owner.json"), `${JSON.stringify(owner)}\n`)
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof ArtifactLifecycleError
              ? cause
              : new ArtifactLifecycleError({ operation: "acquire workspace lock", cause }),
          ),
        )
        return Effect.acquireRelease(acquire, () =>
          Effect.gen(function* () {
            const owner = yield* readOwner(name)
            if (owner?.token === token) {
              yield* fs.remove(lock, { recursive: true, force: true })
            }
          }).pipe(Effect.orDie),
        )
      }

      const cacheRoots = [
        { kind: "pods-cache" as const, root: path.join(artifactsRoot, "pods-cache", "v1") },
        {
          kind: "pods-cache" as const,
          root: path.join(artifactsRoot, "pods-cache", "v2", "entries"),
        },
        { kind: "native-cache" as const, root: path.join(artifactsRoot, "native-cache", "v1") },
      ]

      const prune: Service["prune"] = (options) =>
        Effect.gen(function* () {
          const now = options.nowMillis ?? Date.now()
          const budget = options.cacheBudgetBytes ?? defaultCacheBudgetBytes
          const entries: Array<ArtifactPruneEntry> = []
          const activeWorkspaces = new Set<string>()

          if (
            (yield* fs.exists(artifactsRoot)) &&
            Option.isSome(yield* linkTarget(artifactsRoot))
          ) {
            return {
              dryRun: options.dryRun,
              cacheBudgetBytes: budget,
              cacheBytesBefore: 0,
              cacheBytesAfter: 0,
              reclaimedBytes: 0,
              entries: [
                {
                  path: artifactsRoot,
                  kind: "workspace" as const,
                  decision: "protect" as const,
                  reason: "linked artifact root is never traversed",
                  sizeBytes: 0,
                  lastUsedMillis: now,
                },
              ],
            }
          }

          if ((yield* fs.exists(locksRoot)) && Option.isSome(yield* linkTarget(locksRoot))) {
            entries.push({
              path: locksRoot,
              kind: "lock",
              decision: "protect",
              reason: "linked lock root is never traversed",
              sizeBytes: 0,
              lastUsedMillis: now,
            })
          } else if (yield* fs.exists(locksRoot)) {
            for (const name of (yield* fs.readDirectory(locksRoot)).toSorted()) {
              const lock = path.join(locksRoot, name)
              if (Option.isSome(yield* linkTarget(lock))) {
                entries.push({
                  path: lock,
                  kind: "lock",
                  decision: "protect",
                  reason: "symbolic link is never traversed",
                  sizeBytes: 0,
                  lastUsedMillis: now,
                })
                continue
              }
              const owner = yield* readOwner(name)
              if (owner !== null && isProcessAlive(owner.pid)) {
                activeWorkspaces.add(owner.workspace)
                entries.push({
                  path: lock,
                  kind: "lock",
                  decision: "protect",
                  reason: `active process ${owner.pid}`,
                  sizeBytes: 0,
                  lastUsedMillis: owner.startedAtMillis,
                })
              } else {
                const info = yield* fs.stat(lock)
                if (
                  owner === null &&
                  now - modificationMillis(info) < lockInitializationGraceMillis
                ) {
                  activeWorkspaces.add(name)
                  entries.push({
                    path: lock,
                    kind: "lock",
                    decision: "protect",
                    reason: "workspace lock owner is initializing",
                    sizeBytes: yield* physicalSize(lock),
                    lastUsedMillis: modificationMillis(info),
                  })
                  continue
                }
                entries.push({
                  path: lock,
                  kind: "lock",
                  decision: "delete",
                  reason: "stale workspace lock",
                  sizeBytes: yield* physicalSize(lock),
                  lastUsedMillis: modificationMillis(info),
                })
              }
            }
          }

          const unlocked: Array<{
            path: string
            name: string
            sizeBytes: number
            lastUsedMillis: number
          }> = []
          if (
            (yield* fs.exists(workspacesRoot)) &&
            Option.isSome(yield* linkTarget(workspacesRoot))
          ) {
            entries.push({
              path: workspacesRoot,
              kind: "workspace",
              decision: "protect",
              reason: "linked workspace root is never traversed",
              sizeBytes: 0,
              lastUsedMillis: now,
            })
          } else if (yield* fs.exists(workspacesRoot)) {
            for (const name of (yield* fs.readDirectory(workspacesRoot)).toSorted()) {
              const workspace = path.join(workspacesRoot, name)
              if (Option.isSome(yield* linkTarget(workspace))) {
                entries.push({
                  path: workspace,
                  kind: "workspace",
                  decision: "protect",
                  reason: "symbolic link is never traversed",
                  sizeBytes: 0,
                  lastUsedMillis: now,
                })
                continue
              }
              const info = yield* fs.stat(workspace)
              const item = {
                path: workspace,
                name,
                sizeBytes: yield* physicalSize(workspace),
                lastUsedMillis: modificationMillis(info),
              }
              if (activeWorkspaces.has(name)) {
                entries.push({
                  ...item,
                  kind: "workspace",
                  decision: "protect",
                  reason: "active workspace lock",
                })
              } else {
                unlocked.push(item)
              }
            }
          }
          const newestFailure = unlocked.toSorted(
            (left, right) => right.lastUsedMillis - left.lastUsedMillis,
          )[0]
          for (const item of unlocked) {
            const retain =
              item === newestFailure && now - item.lastUsedMillis < failedWorkspaceRetentionMillis
            let reason = "superseded unlocked workspace"
            if (retain) reason = "newest failed workspace retained for 24 hours"
            else if (item === newestFailure) reason = "failed workspace retention expired"
            entries.push({
              ...item,
              kind: "workspace",
              decision: retain ? "keep" : "delete",
              reason,
            })
          }

          const cacheEntries: Array<{
            path: string
            kind: "pods-cache" | "native-cache"
            decision: "delete" | "keep" | "protect"
            reason: string
            sizeBytes: number
            lastUsedMillis: number
          }> = []
          for (const cache of cacheRoots) {
            if (!(yield* fs.exists(cache.root))) continue
            if (Option.isSome(yield* linkTarget(cache.root))) {
              entries.push({
                path: cache.root,
                kind: cache.kind,
                decision: "protect",
                reason: "linked cache root is never traversed",
                sizeBytes: 0,
                lastUsedMillis: now,
              })
              continue
            }
            for (const name of (yield* fs.readDirectory(cache.root)).toSorted()) {
              const target = path.join(cache.root, name)
              if (Option.isSome(yield* linkTarget(target))) {
                entries.push({
                  path: target,
                  kind: cache.kind,
                  decision: "protect",
                  reason: "symbolic link is never traversed",
                  sizeBytes: 0,
                  lastUsedMillis: now,
                })
                continue
              }
              const info = yield* fs.stat(target)
              cacheEntries.push({
                path: target,
                kind: cache.kind,
                decision: "keep",
                reason: "within persistent cache budget",
                sizeBytes: yield* physicalSize(target),
                lastUsedMillis: modificationMillis(info),
              })
            }
          }
          const cacheBytesBefore = cacheEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0)
          let cacheBytesAfter = cacheBytesBefore
          if (activeWorkspaces.size > 0) {
            entries.push(
              ...cacheEntries.map((entry) => ({
                ...entry,
                decision: "protect" as const,
                reason: "cache protected while a build is active",
              })),
            )
          } else {
            for (const entry of cacheEntries.toSorted(
              (left, right) =>
                left.lastUsedMillis - right.lastUsedMillis || left.path.localeCompare(right.path),
            )) {
              if (cacheBytesAfter <= budget) break
              entry.decision = "delete"
              entry.reason = "least-recently-used entry exceeds the persistent cache budget"
              cacheBytesAfter -= entry.sizeBytes
            }
            entries.push(...cacheEntries)
          }

          const runsRoot = path.join(artifactsRoot, "runs")
          if ((yield* fs.exists(runsRoot)) && Option.isNone(yield* linkTarget(runsRoot))) {
            const visitRuns = (
              directory: string,
            ): Effect.Effect<void, PlatformError.PlatformError> =>
              Effect.gen(function* () {
                for (const name of yield* fs.readDirectory(directory)) {
                  const target = path.join(directory, name)
                  if (Option.isSome(yield* linkTarget(target))) continue
                  const info = yield* fs.stat(target)
                  if (info.type === "Directory") yield* visitRuns(target)
                  else if (
                    bulkyRunOutput(name) &&
                    now - modificationMillis(info) >= bulkyRunRetentionMillis
                  ) {
                    entries.push({
                      path: target,
                      kind: "run-output",
                      decision: "delete",
                      reason: "bulky run output older than 7 days",
                      sizeBytes: allocatedBytes(info),
                      lastUsedMillis: modificationMillis(info),
                    })
                  }
                }
              })
            yield* visitRuns(runsRoot)
          }

          const ordered = entries.toSorted((left, right) => left.path.localeCompare(right.path))
          if (!options.dryRun) {
            for (const entry of ordered) {
              if (entry.decision !== "delete") continue
              yield* fs.remove(entry.path, { recursive: entry.kind !== "run-output", force: true })
            }
          }
          return {
            dryRun: options.dryRun,
            cacheBudgetBytes: budget,
            cacheBytesBefore,
            cacheBytesAfter,
            reclaimedBytes: ordered
              .filter(({ decision }) => decision === "delete")
              .reduce((sum, entry) => sum + entry.sizeBytes, 0),
            entries: ordered,
          }
        }).pipe(
          Effect.mapError(
            (cause) => new ArtifactLifecycleError({ operation: "prune artifacts", cause }),
          ),
        )

      const pruneBeforeBuild = Effect.tryPromise({
        try: async () => {
          const info = await statfs(root)
          return Number(info.bavail) * Number(info.bsize)
        },
        catch: (cause) =>
          new ArtifactLifecycleError({ operation: "measure free disk space", cause }),
      }).pipe(
        Effect.flatMap((freeBytes) =>
          freeBytes < defaultLowDiskBytes ? prune({ dryRun: false }) : Effect.succeed(null),
        ),
      )

      const cleanAll = Effect.gen(function* () {
        const active = yield* prune({ dryRun: true })
        if (
          active.entries.some(
            ({ decision, kind }) =>
              decision === "protect" && (kind === "workspace" || kind === "lock"),
          )
        ) {
          return yield* new ArtifactLifecycleError({
            operation: "clean all artifacts",
            cause: "active or linked workspaces are protected",
          })
        }
        const sizeBytes = (yield* fs.exists(artifactsRoot)) ? yield* physicalSize(artifactsRoot) : 0
        if (yield* fs.exists(artifactsRoot)) yield* fs.remove(artifactsRoot, { recursive: true })
        return {
          dryRun: false,
          cacheBudgetBytes: 0,
          cacheBytesBefore: active.cacheBytesBefore,
          cacheBytesAfter: 0,
          reclaimedBytes: sizeBytes,
          entries: [
            {
              path: artifactsRoot,
              kind: "workspace" as const,
              decision: "delete" as const,
              reason: "explicit artifacts:clean --all",
              sizeBytes,
              lastUsedMillis: Date.now(),
            },
          ],
        }
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof ArtifactLifecycleError
            ? cause
            : new ArtifactLifecycleError({ operation: "clean all artifacts", cause }),
        ),
      )

      const publishNativeProduct: Service["publishNativeProduct"] = (input) =>
        Effect.gen(function* () {
          if (!isSafePathSegment(input.buildId) || path.basename(input.name) !== input.name) {
            return yield* new ArtifactLifecycleError({
              operation: "publish native product",
              cause: "build and product names must be safe path segments",
            })
          }
          const canonicalRoot = yield* fs.realPath(workspacesRoot)
          const canonicalWorkspace = yield* fs.realPath(input.workspace)
          if (canonicalWorkspace !== path.join(canonicalRoot, path.basename(input.workspace))) {
            return yield* new ArtifactLifecycleError({
              operation: "publish native product",
              cause: `refusing linked or nested workspace ${input.workspace}`,
            })
          }
          const destination = path.join(artifactsRoot, "products", input.buildId, input.name)
          const temporary = `${destination}.tmp-${process.pid}`
          if (yield* fs.exists(temporary)) yield* fs.remove(temporary, { recursive: true })
          yield* fs.makeDirectory(path.dirname(destination), { recursive: true })
          yield* fs.copy(input.source, temporary)
          if (yield* fs.exists(destination)) yield* fs.remove(destination, { recursive: true })
          yield* fs.rename(temporary, destination)
          yield* fs.remove(canonicalWorkspace, { recursive: true })
          return destination
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof ArtifactLifecycleError
              ? cause
              : new ArtifactLifecycleError({ operation: "publish native product", cause }),
          ),
        )

      return ArtifactLifecycle.of({
        acquireWorkspace,
        acquireNativeBuild,
        prune,
        pruneBeforeBuild,
        cleanAll,
        publishNativeProduct,
      })
    }),
  )
