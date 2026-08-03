import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { PackageName, type Catalog, type Package } from "../Domain.ts"
import * as Entrypoint from "./Entrypoint.ts"
import { ExpoRepository } from "../ExpoRepository.ts"
import * as NativeRegistration from "./NativeRegistration.ts"
import * as PackageManifest from "./PackageManifest.ts"
import * as PackageRoles from "./PackageRoles.ts"

const BundledModules = Schema.Record(Schema.String, Schema.String)
const bundledModulesPath = "packages/expo/bundledNativeModules.json"
const documentationRoot = "docs/public/static/data/unversioned"

const packageRootFile = (file: string, name: string): boolean =>
  file.endsWith(`/${name}`) &&
  PackageManifest.isPackageManifestPath(`${file.slice(0, -name.length)}package.json`)

const packageFiles = (files: ReadonlyArray<string>, name: string): Map<string, string> =>
  new Map(
    files
      .filter((file) => packageRootFile(file, name))
      .map((file) => [file.slice(0, -(name.length + 1)), file]),
  )

const nativeRegistrationFiles = (files: ReadonlyArray<string>): Map<string, string> => {
  const registrations = packageFiles(files, "unimodule.json")
  for (const [directory, path] of packageFiles(files, "expo-module.config.json")) {
    registrations.set(directory, path)
  }
  return registrations
}

const workspacePackage = (
  manifest: PackageManifest.PackageManifest,
  manifestPath: string,
  bundled: Readonly<Record<string, string>>,
  pluginPath: string | undefined,
  documentationPath: string | undefined,
  nativeRegistration: Package["nativeRegistration"],
): Package => {
  const manifestEntrypoints = Entrypoint.fromManifest(manifest)
  const entrypoints = (
    pluginPath === undefined
      ? manifestEntrypoints
      : Entrypoint.addConfigPlugin(manifest, manifestEntrypoints)
  ).toSorted((left, right) => left.subpath.localeCompare(right.subpath))
  const roleEvidence = PackageRoles.evidence({
    manifest,
    manifestPath,
    bundled: manifest.name in bundled,
    bundledPath: bundledModulesPath,
    documentationPath,
    pluginPath,
    nativeRegistration,
    entrypoints,
  })
  return {
    name: manifest.name,
    version: manifest.version,
    manifestPath,
    bundledVersion: bundled[manifest.name] ?? null,
    subpathPolicy: manifest.exports === undefined ? "open" : "explicit",
    roles: PackageRoles.roles(roleEvidence),
    roleEvidence,
    entrypoints,
    nativeRegistration,
  }
}

const bundledPackage = (name: string, version: string): Package => ({
  name: PackageName.make(name),
  version,
  manifestPath: null,
  bundledVersion: version,
  subpathPolicy: "unresolved",
  roles: ["bundled"],
  roleEvidence: [{ role: "bundled", source: "bundled-native-modules", path: bundledModulesPath }],
  entrypoints: [],
  nativeRegistration: null,
})

export const make = Effect.fn("Catalog.make")(function* () {
  const repository = yield* ExpoRepository
  yield* repository.verify

  const [files, bundled] = yield* Effect.all(
    [repository.expoFiles, repository.readExpoJson(bundledModulesPath, BundledModules)],
    { concurrency: "unbounded" },
  )
  const plugins = packageFiles(files, "app.plugin.js")
  const nativeRegistrations = nativeRegistrationFiles(files)
  const documentationFiles = new Set(
    files.filter((file) => file.startsWith(`${documentationRoot}/`) && file.endsWith(".json")),
  )
  const manifestPaths = files.filter(PackageManifest.isPackageManifestPath)

  const packages = yield* Effect.forEach(
    manifestPaths,
    (manifestPath) =>
      Effect.gen(function* () {
        const manifest = yield* repository.readExpoJson(
          manifestPath,
          PackageManifest.PackageManifest,
        )
        const directory = PackageManifest.directoryOf(manifestPath)
        const nativePath = nativeRegistrations.get(directory)
        const nativeRegistration =
          nativePath === undefined
            ? null
            : yield* repository
                .readExpoText(nativePath)
                .pipe(Effect.flatMap((text) => NativeRegistration.decode(nativePath, text)))
        return workspacePackage(
          manifest,
          manifestPath,
          bundled,
          plugins.get(directory),
          documentationFiles.has(`${documentationRoot}/${manifest.name}.json`)
            ? `${documentationRoot}/${manifest.name}.json`
            : undefined,
          nativeRegistration,
        )
      }),
    { concurrency: "unbounded" },
  )

  const knownPackages = new Set(packages.map((entry) => entry.name as string))
  for (const [name, version] of Object.entries(bundled)) {
    if (!knownPackages.has(name)) packages.push(bundledPackage(name, version))
  }

  const catalog: Catalog = {
    schemaVersion: 3,
    expoRevision: repository.upstreams.expo.revision,
    effectRevision: repository.upstreams.effect.revision,
    packages: packages.toSorted((left, right) => left.name.localeCompare(right.name)),
  }
  return {
    catalog,
    fingerprint: yield* repository.hashString(JSON.stringify(catalog)),
  }
})
