import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const temporaryRoot = mkdtempSync(join(tmpdir(), "better-native-metro-dist-"))
const generated = join(temporaryRoot, "dist")

const run = (command: string, args: ReadonlyArray<string>) =>
  execFileSync(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
  })

try {
  run("bun", [
    "build",
    "src/BetterNativeMetroConfig.ts",
    "--target=node",
    "--format=esm",
    "--external",
    "expo",
    "--external",
    "effect",
    `--outfile=${join(generated, "BetterNativeMetroConfig.js")}`,
  ])
  run("bun", [
    "build",
    "src/BetterNativeMetroConfig.ts",
    "--target=node",
    "--format=cjs",
    "--external",
    "expo",
    "--external",
    "effect",
    `--outfile=${join(generated, "BetterNativeMetroConfig.cjs")}`,
  ])
  run("tsc", ["-p", "tsconfig.build.json", "--outDir", generated])

  const stale = [
    "BetterNativeMetroConfig.js",
    "BetterNativeMetroConfig.cjs",
    "BetterNativeMetroConfig.d.ts",
  ].filter((name) => {
    const tracked = readFileSync(join(packageRoot, "dist", name))
    const expected = readFileSync(join(generated, name))
    return !tracked.equals(expected)
  })

  if (stale.length > 0) {
    throw new Error(`Metro dist is stale: ${stale.map(basename).join(", ")}`)
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
