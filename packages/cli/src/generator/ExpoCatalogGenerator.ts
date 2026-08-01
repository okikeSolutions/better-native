import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import { readGeneratedArtifact, writeGeneratedArtifact } from "./GeneratedArtifact.ts"

const expoCatalogOutputPath = "packages/catalog/src/generated/ExpoPackages.ts"
const expoDocsRoot = "vendor/expo/docs/pages/versions/unversioned/sdk"
const expoPackagesRoot = "vendor/expo/packages"
const bundledModulesPath = "vendor/expo/packages/expo/bundledNativeModules.json"
const expoManifestPath = "vendor/expo/packages/expo/package.json"

class ExpoCatalogSourceError extends Data.TaggedError("ExpoCatalogSourceError")<{
  readonly path: string
  readonly reason: string
}> {}

class ExpoCatalogOutOfDate extends Data.TaggedError("ExpoCatalogOutOfDate")<{
  readonly path: string
}> {}

interface PackageManifest {
  readonly name: string
  readonly version: string
}

interface PackageEntry extends PackageManifest {
  readonly documentation: ReadonlyArray<string>
  readonly catalogStatus: "included" | "excluded"
  readonly catalogClassification:
    | "documented-sdk"
    | "bundled-sdk"
    | "bundled-undocumented"
    | "bundled-only"
    | "excluded-infrastructure"
  readonly exclusionReason: string | null
  readonly sources: {
    readonly publicManifest: boolean
    readonly bundled: boolean
    readonly documented: boolean
  }
}

interface ExpoProvenance {
  readonly sdkVersion: number
  readonly expoVersion: string
  readonly sourceRevision: string
}

const parseJson = (path: string, source: string) =>
  Effect.try({
    try: () => JSON.parse(source) as unknown,
    catch: () => new ExpoCatalogSourceError({ path, reason: "Invalid JSON" })
  })

const readJson = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* parseJson(path, yield* fs.readFileString(path))
  })

const packageNameFromDoc = (source: string): string | undefined => {
  const match = source.match(/^packageName:\s*['"]?([^'"\s]+)['"]?\s*$/m)
  return match?.[1]
}

const isExpoPackage = (name: string): boolean =>
  name === "expo" || name.startsWith("expo-") || name.startsWith("@expo/")

const readPublicManifests = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const manifests = yield* fs.glob("**/package.json", { root: expoPackagesRoot })
  const entries = yield* Effect.forEach(manifests, (manifest) =>
    Effect.gen(function* () {
      const sourcePath = manifest.startsWith(expoPackagesRoot)
        ? manifest
        : `${expoPackagesRoot}/${manifest}`
      const relativePath = sourcePath.startsWith(`${expoPackagesRoot}/`)
        ? sourcePath.slice(expoPackagesRoot.length + 1)
        : sourcePath
      const segments = relativePath.split("/")
      const isTopLevelManifest =
        (segments.length === 2 && segments[1] === "package.json") ||
        (segments.length === 3 && segments[0] === "@expo" && segments[2] === "package.json")
      if (!isTopLevelManifest) return undefined
      const json = yield* readJson(sourcePath)
      if (
        typeof json !== "object" ||
        json === null ||
        !("name" in json) ||
        !("version" in json) ||
        typeof json.name !== "string" ||
        typeof json.version !== "string" ||
        ("private" in json && json.private === true) ||
        !isExpoPackage(json.name)
      ) {
        return undefined
      }
      return { name: json.name, version: json.version } satisfies PackageManifest
    })
  )
  return new Map(
    entries.filter((entry) => entry !== undefined).map((entry) => [entry.name, entry] as const)
  )
})

const readBundledExpoPackages = Effect.gen(function* () {
  const json = yield* readJson(bundledModulesPath)
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return yield* new ExpoCatalogSourceError({
      path: bundledModulesPath,
      reason: "Expected a bundled-native-modules record"
    })
  }
  return new Map(
    Object.entries(json).flatMap(([name, version]) =>
      isExpoPackage(name) && typeof version === "string" ? [[name, version] as const] : []
    )
  )
})

const readDocumentation = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const docs = yield* fs.glob("**/*.mdx", { root: expoDocsRoot })
  const packageDocs = new Map<string, Array<string>>()
  yield* Effect.forEach(
    docs,
    (doc) =>
      Effect.gen(function* () {
        const fullPath = doc.startsWith(expoDocsRoot) ? doc : path.join(expoDocsRoot, doc)
        const name = packageNameFromDoc(yield* fs.readFileString(fullPath))
        if (name === undefined || !isExpoPackage(name)) return
        const current = packageDocs.get(name) ?? []
        current.push(path.relative(expoDocsRoot, fullPath))
        packageDocs.set(name, current)
      }),
    { discard: true }
  )
  return packageDocs
})

const readSourceRevision = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const gitFile = "vendor/expo/.git"
  const gitPointer = (yield* fs.readFileString(gitFile)).trim()
  if (!gitPointer.startsWith("gitdir: ")) {
    return yield* new ExpoCatalogSourceError({ path: gitFile, reason: "Invalid gitdir pointer" })
  }
  const gitDirectory = path.resolve("vendor/expo", gitPointer.slice("gitdir: ".length))
  const headPath = path.join(gitDirectory, "HEAD")
  const head = (yield* fs.readFileString(headPath)).trim()
  let revision = head
  if (head.startsWith("ref: ")) {
    const reference = head.slice("ref: ".length)
    const referencePath = path.join(gitDirectory, reference)
    if (yield* fs.exists(referencePath)) {
      revision = (yield* fs.readFileString(referencePath)).trim()
    } else {
      const packedRefsPath = path.join(gitDirectory, "packed-refs")
      const packedRefs = yield* fs.readFileString(packedRefsPath)
      revision =
        packedRefs
          .split("\n")
          .find((line) => line.endsWith(` ${reference}`))
          ?.split(" ")[0] ?? ""
    }
  }
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    return yield* new ExpoCatalogSourceError({ path: headPath, reason: "Invalid Git revision" })
  }
  return revision
})

const readExpoProvenance = Effect.gen(function* () {
  const manifest = yield* readJson(expoManifestPath)
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  ) {
    return yield* new ExpoCatalogSourceError({
      path: expoManifestPath,
      reason: "Expo manifest has no version"
    })
  }
  const sdkVersion = Number(manifest.version.split(".")[0])
  if (!Number.isSafeInteger(sdkVersion) || sdkVersion <= 0) {
    return yield* new ExpoCatalogSourceError({
      path: expoManifestPath,
      reason: "Expo version does not identify an SDK"
    })
  }
  return {
    sdkVersion,
    expoVersion: manifest.version,
    sourceRevision: (yield* readSourceRevision).slice(0, 12)
  } satisfies ExpoProvenance
})

const readExpoPackages = Effect.gen(function* () {
  const [manifests, bundled, documentation] = yield* Effect.all([
    readPublicManifests,
    readBundledExpoPackages,
    readDocumentation
  ])

  const candidates = new Set([...manifests.keys(), ...bundled.keys()])
  return Array.from(candidates, (name): PackageEntry => {
    const manifest = manifests.get(name)
    const docs = (documentation.get(name) ?? []).sort()
    const isBundled = bundled.has(name)
    const isDocumented = docs.length > 0
    const included = isBundled || isDocumented
    return {
      name,
      version: manifest?.version ?? bundled.get(name)!,
      documentation: docs,
      catalogStatus: included ? "included" : "excluded",
      catalogClassification:
        manifest === undefined
          ? "bundled-only"
          : isDocumented
            ? isBundled
              ? "bundled-sdk"
              : "documented-sdk"
            : isBundled
              ? "bundled-undocumented"
              : "excluded-infrastructure",
      exclusionReason: included
        ? null
        : "Public Expo repository package is neither SDK-documented nor bundled by Expo",
      sources: {
        publicManifest: manifest !== undefined,
        bundled: isBundled,
        documented: isDocumented
      }
    }
  }).sort((left, right) => left.name.localeCompare(right.name))
})

const renderExpoCatalog = (
  provenance: ExpoProvenance,
  packages: ReadonlyArray<PackageEntry>
): string => `// This file is generated by \`effect-expo generate\`. Do not edit it by hand.

export const ExpoProvenance = ${JSON.stringify(provenance, null, 2)} as const

export const ExpoPackages = ${JSON.stringify(packages, null, 2)} as const
`

const expectedCatalog = Effect.all([readExpoProvenance, readExpoPackages]).pipe(
  Effect.map(([provenance, packages]) => renderExpoCatalog(provenance, packages))
)

export const generateExpoCatalog = Effect.gen(function* () {
  yield* writeGeneratedArtifact(expoCatalogOutputPath, yield* expectedCatalog)
})

export const checkExpoCatalog = Effect.gen(function* () {
  const expected = yield* expectedCatalog
  const actual = yield* readGeneratedArtifact(expoCatalogOutputPath)
  if (actual === undefined || actual !== expected) {
    return yield* new ExpoCatalogOutOfDate({ path: expoCatalogOutputPath })
  }
})
