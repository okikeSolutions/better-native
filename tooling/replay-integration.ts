import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import * as Schema from "effect/Schema"
import { CapabilityLedger } from "./compatibility-harness/src/migrations/CapabilityMigrations.ts"
import { replayIntegrationEvidence } from "./compatibility-harness/src/migrations/CapabilityReplay.ts"

interface ReplayOptions {
  readonly runId?: string
  readonly runAttempt?: number
  readonly evidenceDirectory?: string
  readonly capabilityIds: ReadonlyArray<string>
  readonly refresh: boolean
}

const usage = `Usage:
  bun run replay:integration --run-id <github-run-id> [--run-attempt <n>] [--capability <id>] [--refresh]
  bun run replay:integration --evidence-dir <path> [--capability <id>]`

const valueAfter = (args: ReadonlyArray<string>, index: number, option: string): string => {
  const value = args[index + 1]
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value.`)
  return value
}

const parseOptions = (args: ReadonlyArray<string>): ReplayOptions => {
  let runId: string | undefined
  let runAttempt: number | undefined
  let evidenceDirectory: string | undefined
  let refresh = false
  const capabilityIds: Array<string> = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--run-id") runId = valueAfter(args, index++, argument)
    else if (argument === "--run-attempt") {
      const value = valueAfter(args, index++, argument)
      runAttempt = Number(value)
      if (!Number.isSafeInteger(runAttempt) || runAttempt < 1)
        throw new Error(`Invalid run attempt ${JSON.stringify(value)}.`)
    } else if (argument === "--evidence-dir") {
      evidenceDirectory = valueAfter(args, index++, argument)
    } else if (argument === "--capability") {
      capabilityIds.push(valueAfter(args, index++, argument))
    } else if (argument === "--refresh") refresh = true
    else throw new Error(`Unknown option ${JSON.stringify(argument)}.`)
  }
  if ((runId === undefined) === (evidenceDirectory === undefined)) throw new Error(usage)
  if (runId !== undefined && !/^\d+$/.test(runId))
    throw new Error(`Invalid GitHub run ID ${JSON.stringify(runId)}.`)
  if (runId === undefined && (runAttempt !== undefined || refresh))
    throw new Error("--run-attempt and --refresh require --run-id.")
  return { runId, runAttempt, evidenceDirectory, capabilityIds, refresh }
}

const command = (
  executable: string,
  args: ReadonlyArray<string>,
  options?: { readonly encoding?: BufferEncoding },
) => {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: options?.encoding,
    stdio: options?.encoding === undefined ? "inherit" : undefined,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0)
    throw new Error(`${executable} ${args[0] ?? ""} failed with exit code ${result.status ?? 1}.`)
  return result.stdout
}

const repositoryRoot = resolve(import.meta.dirname, "..")

try {
  const options = parseOptions(process.argv.slice(2))
  let expectedCandidateRevision: string | undefined
  let evidenceRoot: string

  if (options.runId !== undefined) {
    const metadata = JSON.parse(
      command("gh", ["run", "view", options.runId, "--json", "attempt,headSha"], {
        encoding: "utf8",
      }),
    ) as { readonly attempt: number; readonly headSha: string }
    const attempt = options.runAttempt ?? metadata.attempt
    expectedCandidateRevision = metadata.headSha
    evidenceRoot = resolve(
      repositoryRoot,
      ".artifacts",
      "replays",
      `github-${options.runId}-${attempt}`,
    )
    if (options.refresh || !existsSync(evidenceRoot)) {
      const replayParent = resolve(repositoryRoot, ".artifacts", "replays")
      mkdirSync(replayParent, { recursive: true })
      const temporary = mkdtempSync(resolve(replayParent, `.download-${options.runId}-${attempt}-`))
      try {
        console.log(
          `Downloading comparison verdicts from GitHub run ${options.runId}, attempt ${attempt}.`,
        )
        command("gh", [
          "run",
          "download",
          options.runId,
          "--pattern",
          `compatibility-*-verdict-${options.runId}-${attempt}`,
          "--dir",
          temporary,
        ])
        rmSync(evidenceRoot, { recursive: true, force: true })
        renameSync(temporary, evidenceRoot)
      } catch (cause) {
        rmSync(temporary, { recursive: true, force: true })
        throw cause
      }
    } else {
      console.log(`Reusing downloaded verdicts in ${evidenceRoot}.`)
    }
  } else {
    evidenceRoot = resolve(repositoryRoot, options.evidenceDirectory as string)
  }

  const ledger = Schema.decodeUnknownSync(CapabilityLedger)(
    JSON.parse(readFileSync(resolve(repositoryRoot, "compatibility/capabilities.json"), "utf8")),
  )
  const upstreams = JSON.parse(
    readFileSync(resolve(repositoryRoot, "compatibility/upstreams.json"), "utf8"),
  ) as { readonly expo: { readonly revision: string } }
  const replay = replayIntegrationEvidence({
    repositoryRoot,
    evidenceRoot,
    capabilities: ledger.capabilities,
    expectedExpoRevision: upstreams.expo.revision,
    expectedCandidateRevision,
    capabilityIds: options.capabilityIds.length === 0 ? undefined : options.capabilityIds,
  })
  const evaluatorRevision = command("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const evaluatorDirty =
    command("git", ["status", "--porcelain", "--untracked-files=no"], {
      encoding: "utf8",
    }).trim().length > 0

  console.log(`\nReplaying ${replay.recordCount} verdicts for subject ${replay.candidateRevision}.`)
  console.log(`Evaluator: ${evaluatorRevision}${evaluatorDirty ? " (dirty)" : ""}.`)
  let failed = false
  for (const capability of replay.capabilities) {
    console.log(`\n${capability.sourceId}`)
    for (const obligation of capability.obligations) {
      console.log(
        `${obligation.status === "verified" ? "✓" : "✗"} ${obligation.platform}/${obligation.deviceKind}: ${obligation.status}${obligation.path === undefined ? "" : ` (${obligation.path})`}`,
      )
    }
    failed ||= !capability.verified
  }
  if (failed) throw new Error("Integration replay failed; no live device run was started.")
  console.log(
    `\nIntegration replay passed for ${replay.capabilities.length} capabilities. Physical-device evidence was not evaluated.`,
  )
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause))
  process.exit(1)
}
