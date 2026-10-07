import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Semver from "semver"
import { HarnessError } from "../HarnessError.ts"
import { ExpoRepository } from "../ExpoRepository.ts"
import * as BunLock from "../installation/BunLock.ts"
import { ProcessSupervisor } from "../supervision/ProcessSupervisor.ts"

const Advisory = Schema.Struct({
  url: Schema.String,
  severity: Schema.String,
  vulnerable_versions: Schema.String,
})
const JsonObject = Schema.Record(Schema.String, Schema.Json)

/** JSON advisory report produced by `bun audit --json`. */
export const AuditReport = Schema.Record(Schema.String, Schema.Array(Advisory))
/** Decoded dependency-audit report accepted by {@link AuditReport}. */
export type AuditReport = Schema.Schema.Type<typeof AuditReport>

/** Reviewed exception binding an advisory to an exact lockfile dependency path. */
export interface ReviewedException {
  readonly owners: ReadonlyArray<{ readonly lockKey: string; readonly identifier: string }>
  readonly dependency: {
    readonly lockKey: string
    readonly name: string
    readonly version: string
  }
  readonly advisories: ReadonlyArray<string>
}

/** Signals unreviewed or stale dependency advisories. */
export class SecurityAuditError extends Schema.TaggedError<SecurityAuditError>()(
  "SecurityAuditError",
  {
    issues: Schema.Array(Schema.String),
  },
) {}

const reviewed: ReadonlyArray<ReviewedException> = [
  {
    // Metro reads image dimensions from reviewed project assets during bundling. The affected
    // Metro requires the vulnerable 1.x line; image-size 2.x is patched. This toolchain-only path
    // is not shipped by a publishable Better Native runtime package. Keep the exception exact so
    // a new path, version, owner, or resolved advisory fails closed.
    owners: [{ lockKey: "metro", identifier: "metro@0.84.4" }],
    dependency: { lockKey: "image-size", name: "image-size", version: "1.2.1" },
    advisories: ["GHSA-5p2g-fcmc-qvqq", "GHSA-w3rx-r6r6-pgpr"],
  },
  {
    // Micromatch receives repository-controlled glob patterns during bundling. The published
    // braces 3.x line has no patched version for nested-pattern stack exhaustion.
    owners: [{ lockKey: "micromatch", identifier: "micromatch@4.0.8" }],
    dependency: { lockKey: "braces", name: "braces", version: "3.0.3" },
    advisories: ["GHSA-vfj7-8cjw-p6xm"],
  },
  {
    // Expo CLI and its code-signing helper use node-forge during development and build tooling.
    // No patched release exists for this signature-verification advisory.
    owners: [
      { lockKey: "@expo/cli", identifier: "@expo/cli@57.0.11" },
      {
        lockKey: "@expo/code-signing-certificates",
        identifier: "@expo/code-signing-certificates@0.0.6",
      },
    ],
    dependency: { lockKey: "node-forge", name: "node-forge", version: "1.4.0" },
    advisories: ["GHSA-86w9-cpqp-85rv"],
  },
  {
    // The old argparse path is used by docgen's Markdown parser with repository-owned files.
    // There is no patched sprintf-js 1.x release for unbounded precision specifiers.
    owners: [{ lockKey: "argparse", identifier: "argparse@1.0.10" }],
    dependency: { lockKey: "sprintf-js", name: "sprintf-js", version: "1.0.3" },
    advisories: ["GHSA-hp3w-g68c-fv3c"],
  },
]

const advisoryId = (url: string): string => url.slice(url.lastIndexOf("/") + 1)

const entryIdentifier = (lock: BunLock.BunLock, key: string): string | null => {
  const identifier = lock.packages[key]?.[0]
  return typeof identifier === "string" ? identifier : null
}

const dependencyNames = (lock: BunLock.BunLock, key: string): ReadonlySet<string> => {
  const metadata = lock.packages[key]?.[2]
  if (!Schema.is(JsonObject)(metadata)) return new Set()
  const dependencies = metadata.dependencies
  if (!Schema.is(JsonObject)(dependencies)) return new Set()
  return new Set(Object.keys(dependencies))
}

const directOwnerKeys = (lock: BunLock.BunLock, dependencyName: string): ReadonlyArray<string> =>
  Object.keys(lock.packages)
    .filter((key) => dependencyNames(lock, key).has(dependencyName))
    .toSorted()

const installedVersion = (identifier: string, packageName: string): string | null => {
  const prefix = `${packageName}@`
  return identifier.startsWith(prefix) ? identifier.slice(prefix.length) : null
}

/**
 * Validates audit findings against exact reviewed lockfile exceptions.
 *
 * @remarks
 * Exceptions bind an advisory to both the exact vulnerable package entry and its
 * reviewed owner path. Stale or broadened dependency paths are reported as issues.
 *
 * @param report - Current dependency audit findings.
 * @param lock - Current Bun lockfile.
 * @param policy - Reviewed exceptions; defaults to the checked-in policy.
 * @returns Unreviewed findings and stale exception issues.
 */
export const validate = (
  report: AuditReport,
  lock: BunLock.BunLock,
  policy: ReadonlyArray<ReviewedException> = reviewed,
): ReadonlyArray<string> => {
  const issues: Array<string> = []
  const findings = Object.entries(report).flatMap(([packageName, advisories]) =>
    advisories.map((advisory) => ({ packageName, advisory, id: advisoryId(advisory.url) })),
  )
  for (const exception of policy) {
    for (const reviewedOwner of exception.owners) {
      const owner = entryIdentifier(lock, reviewedOwner.lockKey)
      if (owner !== reviewedOwner.identifier) {
        issues.push(
          `stale owner ${reviewedOwner.lockKey}: expected ${reviewedOwner.identifier}, found ${owner ?? "missing"}`,
        )
      }
    }
    const actualOwners = directOwnerKeys(lock, exception.dependency.name)
    const reviewedOwners = exception.owners.map(({ lockKey }) => lockKey).toSorted()
    if (actualOwners.join("\0") !== reviewedOwners.join("\0")) {
      issues.push(
        `direct owners for ${exception.dependency.name} changed: expected ${reviewedOwners.join(", ")}; found ${actualOwners.join(", ")}`,
      )
    }
    const expectedDependency = `${exception.dependency.name}@${exception.dependency.version}`
    const dependency = entryIdentifier(lock, exception.dependency.lockKey)
    if (dependency !== expectedDependency) {
      issues.push(
        `stale dependency ${exception.dependency.lockKey}: expected ${expectedDependency}, found ${dependency ?? "missing"}`,
      )
    }
    for (const id of exception.advisories) {
      if (
        !findings.some(
          (finding) => finding.packageName === exception.dependency.name && finding.id === id,
        )
      ) {
        issues.push(`stale exception ${exception.dependency.lockKey} ${id}`)
      }
    }
  }
  for (const finding of findings) {
    const exceptions = policy.filter(
      (exception) =>
        exception.dependency.name === finding.packageName &&
        exception.advisories.includes(finding.id),
    )
    if (exceptions.length === 0) {
      issues.push(`unreviewed ${finding.packageName} ${finding.id} (${finding.advisory.severity})`)
      continue
    }
    const vulnerableKeys = Object.entries(lock.packages).flatMap(([key, entry]) => {
      const identifier = entry[0]
      if (typeof identifier !== "string") return []
      const version = installedVersion(identifier, finding.packageName)
      return version !== null && Semver.satisfies(version, finding.advisory.vulnerable_versions)
        ? [key]
        : []
    })
    const reviewedKeys = exceptions.map(({ dependency }) => dependency.lockKey).toSorted()
    if (vulnerableKeys.toSorted().join("\0") !== reviewedKeys.join("\0")) {
      issues.push(
        `dependency paths for ${finding.packageName} ${finding.id} changed: expected ${reviewedKeys.join(", ")}; found ${vulnerableKeys.toSorted().join(", ")}`,
      )
    }
  }
  return issues
}

/**
 * Runs the dependency audit and rejects findings without reviewed exceptions.
 *
 * @returns An Effect that succeeds after every finding is accepted by policy.
 * @throws {@link HarnessError} when the audit process or report cannot be read.
 * @throws {@link SecurityAuditError} when findings are unreviewed or exceptions are stale.
 */
export const run = Effect.fn("AuditPolicy.run")(function* () {
  const repository = yield* ExpoRepository
  const processes = yield* ProcessSupervisor
  const result = yield* processes.run({
    command: "bun",
    args: ["audit", "--json", "--audit-level=moderate"],
    cwd: repository.root,
    timeoutMillis: 60_000,
  })
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return yield* new HarnessError({
      operation: "run dependency audit",
      cause: `bun audit exited ${result.exitCode}`,
    })
  }
  const output = result.observations
    .filter(({ stream }) => stream === "stdout")
    .map(({ text }) => text)
    .join("\n")
  const jsonStart = output.indexOf("{")
  if (jsonStart < 0) {
    return yield* new HarnessError({ operation: "parse dependency audit", cause: "missing JSON" })
  }
  const parsed = yield* Effect.try({
    try: () => JSON.parse(output.slice(jsonStart)) as unknown,
    catch: (cause) => new HarnessError({ operation: "parse dependency audit", cause }),
  })
  const report = yield* Schema.decodeUnknownEffect(AuditReport)(parsed).pipe(
    Effect.mapError((cause) => new HarnessError({ operation: "decode dependency audit", cause })),
  )
  const lock = yield* BunLock.read(`${repository.root}/bun.lock`)
  const issues = validate(report, lock)
  if (issues.length > 0) {
    yield* Console.error(issues.join("\n"))
    return yield* new SecurityAuditError({ issues })
  }
  yield* Console.log(`Dependency audit accepted ${Object.values(report).flat().length} findings`)
  return undefined
})
