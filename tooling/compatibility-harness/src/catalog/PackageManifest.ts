import * as Schema from "effect/Schema"
import { PackageName } from "../Domain.ts"

/** Minimal package manifest fields needed for catalog derivation. */
export const PackageManifest = Schema.Struct({
  name: PackageName,
  version: Schema.String,
  gitHead: Schema.optional(Schema.String),
  private: Schema.optional(Schema.Boolean),
  main: Schema.optional(Schema.String),
  module: Schema.optional(Schema.String),
  types: Schema.optional(Schema.String),
  browser: Schema.optional(Schema.Json),
  "react-native": Schema.optional(Schema.Json),
  exports: Schema.optional(Schema.Json),
  bin: Schema.optional(Schema.Json),
  homepage: Schema.optional(Schema.String),
  sideEffects: Schema.optional(Schema.Json),
  files: Schema.optional(Schema.Array(Schema.String)),
  typesVersions: Schema.optional(Schema.Json),
})

/** Decoded package manifest accepted by {@link PackageManifest}. */
export type PackageManifest = Schema.Schema.Type<typeof PackageManifest>

/**
 * Returns whether a repository file is a package manifest.
 *
 * @param file - Repository-relative file path.
 * @returns Whether the final path segment is `package.json`.
 */
export const isPackageManifestPath = (file: string): boolean =>
  /^packages\/(?:[^/]+|@expo\/[^/]+|@unimodules\/[^/]+)\/package\.json$/.test(file)

/**
 * Returns the normalized package directory containing a manifest path.
 *
 * @param manifestPath - Repository-relative package manifest path.
 * @returns The containing directory without a trailing separator.
 */
export const directoryOf = (manifestPath: string): string =>
  manifestPath.slice(0, -"/package.json".length)
