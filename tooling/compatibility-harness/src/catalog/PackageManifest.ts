import * as Schema from "effect/Schema"
import { PackageName } from "../Domain.ts"

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

export type PackageManifest = Schema.Schema.Type<typeof PackageManifest>

export const isPackageManifestPath = (file: string): boolean =>
  /^packages\/(?:[^/]+|@expo\/[^/]+|@unimodules\/[^/]+)\/package\.json$/.test(file)

export const directoryOf = (manifestPath: string): string =>
  manifestPath.slice(0, -"/package.json".length)
