import { readFileSync, readdirSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

interface Capability {
  readonly id: string
  readonly candidatePackage: string
  readonly requirements: {
    readonly platforms: ReadonlyArray<string>
    readonly dxEval: boolean
  }
}

interface Ledger {
  readonly capabilities: ReadonlyArray<Capability>
}

const repositoryRoot = resolve(import.meta.dirname, "..")
const id = process.argv[2]
if (id === undefined || id.length === 0) {
  console.error("Usage: bun run verify:capability <capability-id>")
  process.exit(2)
}

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

console.log("\nLocal fast verification passed.")
console.log(
  `CI remains responsible for installation, ${capability.requirements.dxEval ? "DX eval controls, " : ""}${capability.requirements.platforms.join("/")} parity, and other process-boundary evidence.`,
)
