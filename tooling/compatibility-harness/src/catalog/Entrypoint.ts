import type { Json } from "effect/Schema"
import { Subpath, type Entrypoint, type PackageName } from "../Domain.ts"
import type { PackageManifest } from "./PackageManifest.ts"
import * as Resolution from "./Resolution.ts"

const isRecord = (value: Json): value is { readonly [key: string]: Json } =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const targetStrings = (value: Json): ReadonlyArray<string> => {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(targetStrings)
  if (isRecord(value)) return Object.values(value).flatMap(targetStrings)
  return []
}

const codeTarget = /\.(?:[cm]?[jt]sx?|d\.[cm]?ts)$/

/**
 * Classifies one package subpath from its conditional export target.
 *
 * @remarks
 * Classification preserves the raw resolution tree because platform-specific
 * branches are compatibility evidence, not a value to flatten prematurely.
 *
 * @param packageName - Owning package name used for conventional classification.
 * @param subpath - Package subpath being classified.
 * @param resolution - Raw target value from the package manifest.
 * @returns The entrypoint kind and normalized resolution branches.
 */
export const classify = (
  packageName: PackageName,
  subpath: string,
  resolution: Json,
): Entrypoint["kind"] => {
  if (subpath === "./package.json" || subpath.endsWith(".json")) return "metadata"
  if (
    subpath.includes("app.plugin") ||
    /^\.\/(?:plugin|babel-plugin)(?:$|\/)/.test(subpath) ||
    /\/(?:babel|metro-config|config-plugins?)(?:$|\/)/.test(subpath)
  ) {
    return "build-time"
  }
  if (
    packageName === "expo-server" ||
    /\/(?:server|rsc)(?:$|\/)/.test(subpath) ||
    subpath.startsWith("./rsc")
  ) {
    return "server"
  }
  const targets = targetStrings(resolution)
  if (
    subpath.includes("/assets/") ||
    (targets.length > 0 && targets.every((target) => !codeTarget.test(target)))
  ) {
    return "asset"
  }
  return "runtime"
}

const makeEntrypoint = (
  packageName: PackageName,
  subpath: string,
  source: Entrypoint["resolution"]["source"],
  value: Json,
): Entrypoint => ({
  subpath: Subpath.make(subpath),
  kind: classify(packageName, subpath, value),
  pattern: subpath.includes("*"),
  resolution: { source, value },
  resolutionBranches: Resolution.branches(value),
})

const manifestResolution = (manifest: PackageManifest): Json => ({
  main: manifest.main ?? null,
  module: manifest.module ?? null,
  types: manifest.types ?? null,
  browser: manifest.browser ?? null,
  "react-native": manifest["react-native"] ?? null,
  typesVersions: manifest.typesVersions ?? null,
})

/**
 * Derives all declared entrypoints from a package manifest.
 *
 * @remarks
 * Explicit exports are authoritative. Conventional root and config-plugin
 * entrypoints are added only when the manifest does not declare them.
 *
 * @param manifest - Decoded package manifest.
 * @returns Deterministically ordered entrypoint records.
 */
export const fromManifest = (manifest: PackageManifest): ReadonlyArray<Entrypoint> => {
  if (manifest.exports === undefined) {
    return [
      makeEntrypoint(manifest.name, ".", "manifest", manifestResolution(manifest)),
      makeEntrypoint(manifest.name, "./package.json", "convention", "./package.json"),
    ]
  }

  if (isRecord(manifest.exports)) {
    const subpaths = Object.entries(manifest.exports).filter(([key]) => key.startsWith("."))
    if (subpaths.length > 0) {
      return subpaths.map(([subpath, resolution]) =>
        makeEntrypoint(manifest.name, subpath, "exports", resolution),
      )
    }
  }

  return [makeEntrypoint(manifest.name, ".", "exports", manifest.exports)]
}

/**
 * Adds a conventional config-plugin entrypoint when the manifest exposes one.
 *
 * @param entrypoints - Existing package entrypoints.
 * @param manifest - Decoded package manifest.
 * @returns Entry points including the normalized config-plugin target.
 */
export const addConfigPlugin = (
  manifest: PackageManifest,
  entrypoints: ReadonlyArray<Entrypoint>,
): ReadonlyArray<Entrypoint> =>
  entrypoints.some((entrypoint) => entrypoint.subpath.replace(/\.js$/, "") === "./app.plugin")
    ? entrypoints
    : [
        ...entrypoints,
        makeEntrypoint(manifest.name, "./app.plugin", "convention", "./app.plugin.js"),
      ]
