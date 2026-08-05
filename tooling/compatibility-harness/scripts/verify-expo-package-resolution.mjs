import { readFileSync, realpathSync } from "node:fs"
import { findPackageJSON } from "node:module"
import { dirname, join, relative } from "node:path"
import { pathToFileURL } from "node:url"

const [manifestPath, appDirectory] = process.argv.slice(2)
if (manifestPath === undefined || appDirectory === undefined) {
  throw new Error("usage: verify-expo-package-resolution <manifest> <app-directory>")
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages)) {
  throw new Error("invalid Expo package resolution manifest")
}

const appManifestUrl = pathToFileURL(join(appDirectory, "package.json"))
const pinnedExpoRoot = process.env.BETTER_NATIVE_PINNED_EXPO_ROOT
if (pinnedExpoRoot === undefined) throw new Error("BETTER_NATIVE_PINNED_EXPO_ROOT is required")
const canonicalPinnedExpoRoot = realpathSync(pinnedExpoRoot)
const materializedNodeModules = join(appDirectory, "..", "..", "node_modules")
const resolvePackageRoot = (name) => {
  const packageManifest = findPackageJSON(name, appManifestUrl)
  if (packageManifest === undefined) throw new Error(`could not locate package root for ${name}`)
  return dirname(packageManifest)
}

for (const entry of manifest.packages) {
  if (
    typeof entry?.name !== "string" ||
    typeof entry?.source !== "string" ||
    typeof entry?.direct !== "boolean" ||
    (entry?.owner !== "pinned-expo" && entry?.owner !== "root")
  ) {
    throw new Error("invalid Expo package resolution entry")
  }
  const expected = realpathSync(entry.source)
  const materialized = realpathSync(join(materializedNodeModules, ...entry.name.split("/")))
  if (materialized !== expected) {
    throw new Error(
      `${entry.name} materialized to ${materialized}; expected package source ${expected}`,
    )
  }
  if (entry.direct) {
    const resolved = realpathSync(resolvePackageRoot(entry.name))
    if (resolved !== expected) {
      throw new Error(`${entry.name} resolved to ${resolved}; expected package source ${expected}`)
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      name: entry.name,
      owner: entry.owner,
      source: entry.owner === "pinned-expo" ? relative(canonicalPinnedExpoRoot, expected) : "root",
    })}\n`,
  )
}
