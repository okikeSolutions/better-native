import type { Entrypoint, NativeRegistration, PackageRole, RoleEvidence } from "../Domain.ts"
import type { PackageManifest } from "./PackageManifest.ts"

/** Package metadata used to derive reviewed catalog roles. */
export interface EvidenceInput {
  readonly manifest: PackageManifest
  readonly manifestPath: string
  readonly bundled: boolean
  readonly bundledPath: string
  readonly documentationPath: string | undefined
  readonly pluginPath: string | undefined
  readonly nativeRegistration: NativeRegistration | null
  readonly entrypoints: ReadonlyArray<Entrypoint>
}

const isSdkHomepage = (homepage: string | undefined): boolean =>
  homepage?.startsWith("https://docs.expo.dev/versions/latest/sdk/") === true

/**
 * Derives role evidence without inferring unsupported roles from package names.
 *
 * @param input - Manifest, homepage, docs, and native-registration signals.
 * @returns Evidence entries in stable precedence order.
 */
export const evidence = (input: EvidenceInput): ReadonlyArray<RoleEvidence> => {
  const output: Array<RoleEvidence> = [
    { role: "workspace", source: "workspace-manifest", path: input.manifestPath },
  ]
  if (isSdkHomepage(input.manifest.homepage)) {
    output.push({ role: "sdk", source: "sdk-homepage", path: input.manifestPath })
  } else if (input.documentationPath !== undefined) {
    output.push({ role: "sdk", source: "docs-api-data", path: input.documentationPath })
  }
  if (input.bundled) {
    output.push({ role: "bundled", source: "bundled-native-modules", path: input.bundledPath })
  }
  if (input.nativeRegistration !== null && input.nativeRegistration.kind === "config") {
    output.push({
      role: "native",
      source: "expo-module-config",
      path: input.nativeRegistration.path,
    })
  }
  if (input.pluginPath !== undefined) {
    output.push({ role: "config-plugin", source: "app-plugin", path: input.pluginPath })
  }
  if (input.manifest.bin !== undefined) {
    output.push({ role: "cli", source: "manifest-bin", path: input.manifestPath })
  }
  if (input.entrypoints.some((entrypoint) => entrypoint.kind === "server")) {
    output.push({ role: "server", source: "server-entrypoint", path: input.manifestPath })
  }
  return output
}

/**
 * Returns unique package roles represented by the supplied evidence.
 *
 * @param roleEvidence - Evidence entries derived for one package.
 * @returns Unique roles in first-evidence order.
 */
export const roles = (roleEvidence: ReadonlyArray<RoleEvidence>): ReadonlyArray<PackageRole> =>
  [...new Set(roleEvidence.map((entry) => entry.role))].toSorted()
