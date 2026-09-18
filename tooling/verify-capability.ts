import { readFileSync, readdirSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { readCapabilityProfileEvidence } from "./compatibility-harness/src/migrations/CapabilityEvidence.ts"
import { parseCapabilityVerificationOptions } from "./compatibility-harness/src/migrations/CapabilityVerification.ts"

interface Capability {
  readonly id: string
  readonly candidatePackage: string
  readonly requirements: {
    readonly platforms: ReadonlyArray<string>
    readonly dxEval: boolean
    readonly physicalDevice: boolean
  }
  readonly compatibilitySource: string
  readonly verification: {
    readonly parityPlatforms: ReadonlyArray<"web" | "ios" | "android">
  }
}

interface Ledger {
  readonly capabilities: ReadonlyArray<Capability>
}

const repositoryRoot = resolve(import.meta.dirname, "..")
const parsedOptions = parseCapabilityVerificationOptions(process.argv.slice(2))
if (!parsedOptions.ok) {
  console.error(parsedOptions.message)
  process.exit(2)
}
const { capabilityId: id, profile } = parsedOptions.options

const ledger = JSON.parse(
  readFileSync(resolve(repositoryRoot, "compatibility/capabilities.json"), "utf8"),
) as Ledger
const capability = ledger.capabilities.find((candidate) => candidate.id === id)
if (capability === undefined) {
  console.error(`Unknown capability ${JSON.stringify(id)}.`)
  console.error(
    `Available capabilities: ${ledger.capabilities.map(({ id: capabilityId }) => capabilityId).join(", ")}`,
  )
  process.exit(2)
}

const packageDirectory = readdirSync(resolve(repositoryRoot, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `packages/${entry.name}`)
  .find((directory) => {
    const manifest = JSON.parse(
      readFileSync(resolve(repositoryRoot, directory, "package.json"), "utf8"),
    ) as { readonly name?: string }
    return manifest.name === capability.candidatePackage
  })

if (packageDirectory === undefined) {
  console.error(`No workspace package provides ${capability.candidatePackage}.`)
  process.exit(1)
}

const run = (label: string, command: string, args: ReadonlyArray<string>) => {
  console.log(`\n==> ${label}`)
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run("Package static contracts", "bun", [
  "x",
  "turbo",
  "run",
  "typecheck",
  "check:effect",
  "docs:api",
  "--filter",
  capability.candidatePackage,
  "--concurrency=90%",
])
run("Package unit coverage", "bun", ["run", "--cwd", packageDirectory, "test:coverage"])
run("Generated compatibility data", "bun", [
  "run",
  "tooling/compatibility-harness/src/checkGenerated.ts",
])
run("Strict migration ledger", "bun", ["run", "migration-status", "--strict"])

console.log("\nHost verification passed.")
if (profile === "host") {
  console.log(
    `CI remains responsible for installation, ${capability.requirements.dxEval ? "DX eval controls, " : ""}${capability.requirements.platforms.join("/")} parity, and other process-boundary evidence.`,
  )
  process.exit(0)
}

const upstreams = JSON.parse(
  readFileSync(resolve(repositoryRoot, "compatibility/upstreams.json"), "utf8"),
) as { readonly expo: { readonly revision: string } }
const revisionResult = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
if (revisionResult.status !== 0) {
  console.error("Could not determine the candidate Git revision for retained evidence.")
  process.exit(1)
}
if (process.env.GITHUB_SHA === undefined) {
  const worktreeResult = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
  if (worktreeResult.status !== 0 || worktreeResult.stdout.trim().length > 0) {
    console.error(
      "Retained evidence cannot identify uncommitted tracked changes. Commit them or run the host profile.",
    )
    process.exit(1)
  }
}
const candidateRevision = process.env.GITHUB_SHA ?? revisionResult.stdout.trim()
const evidence = readCapabilityProfileEvidence(
  {
    repositoryRoot,
    candidateRevision,
    expoRevision: upstreams.expo.revision,
  },
  capability,
  profile,
)

console.log(`\n==> Retained ${profile} evidence`)
for (const obligation of evidence.obligations) {
  const location = obligation.path === undefined ? "" : ` (${obligation.path})`
  console.log(
    `${obligation.status === "verified" ? "✓" : "✗"} ${obligation.platform}/${obligation.deviceKind}: ${obligation.status}${location}`,
  )
  if (obligation.status !== "verified") console.log(`  ${obligation.detail}`)
}
if (!evidence.verified) {
  console.error(`\n${profile} verification is incomplete; no live native build was started.`)
  process.exit(1)
}
console.log(`\n${profile[0]?.toUpperCase()}${profile.slice(1)} verification passed.`)
