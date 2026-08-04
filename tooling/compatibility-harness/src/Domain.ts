import * as Schema from "effect/Schema"

export const PackageName = Schema.String.pipe(Schema.brand("@better-native/PackageName"))
export const Subpath = Schema.String.pipe(Schema.brand("@better-native/Subpath"))
export const ExportName = Schema.String.pipe(Schema.brand("@better-native/ExportName"))
export const SurfaceId = Schema.String.pipe(Schema.brand("@better-native/SurfaceId"))
export const SuiteId = Schema.String.pipe(Schema.brand("@better-native/SuiteId"))
export const TestSourceId = Schema.String.pipe(Schema.brand("@better-native/TestSourceId"))
export const TestCaseId = Schema.String.pipe(Schema.brand("@better-native/TestCaseId"))
export const BuildId = Schema.String.pipe(Schema.brand("@better-native/BuildId"))
export const RunId = Schema.String.pipe(Schema.brand("@better-native/RunId"))
export const ArtifactId = Schema.String.pipe(Schema.brand("@better-native/ArtifactId"))
export const ObservationId = Schema.String.pipe(Schema.brand("@better-native/ObservationId"))
export const AttemptId = Schema.String.pipe(Schema.brand("@better-native/AttemptId"))
export const DeviceId = Schema.String.pipe(Schema.brand("@better-native/DeviceId"))
export const ContentHash = Schema.String.pipe(Schema.brand("@better-native/ContentHash"))

export const Platform = Schema.Literals([
  "host",
  "android",
  "ios",
  "web",
  "tvos",
  "macos",
  "server",
  "ci",
])
export const Mode = Schema.Literals(["upstream", "candidate"])

export const EntrypointKind = Schema.Literals([
  "runtime",
  "build-time",
  "server",
  "metadata",
  "asset",
])
export const ResolutionSource = Schema.Literals(["exports", "manifest", "convention"])
export const Resolution = Schema.Struct({ source: ResolutionSource, value: Schema.Json })
export const ResolutionBranch = Schema.Struct({
  conditions: Schema.Array(Schema.String),
  fallback: Schema.Array(Schema.Int),
  target: Schema.NullOr(Schema.String),
  platforms: Schema.Array(Schema.String),
})
export const Entrypoint = Schema.Struct({
  subpath: Subpath,
  kind: EntrypointKind,
  pattern: Schema.Boolean,
  resolution: Resolution,
  resolutionBranches: Schema.Array(ResolutionBranch),
})

export const PackageRole = Schema.Literals([
  "workspace",
  "sdk",
  "bundled",
  "native",
  "config-plugin",
  "cli",
  "server",
])
export const RoleEvidence = Schema.Struct({
  role: PackageRole,
  source: Schema.Literals([
    "workspace-manifest",
    "sdk-homepage",
    "docs-api-data",
    "bundled-native-modules",
    "expo-module-config",
    "app-plugin",
    "manifest-bin",
    "server-entrypoint",
  ]),
  path: Schema.String,
})
const NativeRegistrationConfig = Schema.Struct({
  kind: Schema.Literal("config"),
  path: Schema.String,
  declaredPlatforms: Schema.Array(Schema.String),
  autolinkingPlatforms: Schema.Array(Schema.String),
  appleModules: Schema.Array(Schema.String),
  androidModules: Schema.Array(Schema.String),
  appDelegateSubscribers: Schema.Array(Schema.String),
  reactDelegateHandlers: Schema.Array(Schema.String),
  androidServices: Schema.Array(Schema.String),
  coreFeatures: Schema.Array(Schema.String),
  devtoolsServerEntryPoint: Schema.NullOr(Schema.String),
  raw: Schema.Json,
})
const NativeRegistrationTemplate = Schema.Struct({
  kind: Schema.Literal("template"),
  path: Schema.String,
})
export const NativeRegistration = Schema.Union([
  NativeRegistrationConfig,
  NativeRegistrationTemplate,
])
export const Package = Schema.Struct({
  name: PackageName,
  version: Schema.String,
  manifestPath: Schema.NullOr(Schema.String),
  bundledVersion: Schema.NullOr(Schema.String),
  subpathPolicy: Schema.Literals(["explicit", "open", "unresolved"]),
  roles: Schema.Array(PackageRole),
  roleEvidence: Schema.Array(RoleEvidence),
  entrypoints: Schema.Array(Entrypoint),
  nativeRegistration: Schema.NullOr(NativeRegistration),
})
export const Catalog = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  expoRevision: Schema.String,
  effectRevision: Schema.String,
  packages: Schema.Array(Package),
})
export const CatalogSnapshot = Schema.Struct({ catalog: Catalog, fingerprint: Schema.String })

export const InstallationStatus = Schema.Literals([
  "valid",
  "missing",
  "not-declared",
  "version-mismatch",
  "unlocked",
])
export const PackageResolution = Schema.Struct({
  version: Schema.String,
  integrity: Schema.NullOr(Schema.String),
})
export const ExpandedEntrypoint = Schema.Struct({
  declarationSource: Schema.Literals(["pinned", "installed-external"]),
  declaredSubpath: Subpath,
  subpath: Subpath,
  matchedFiles: Schema.Array(Schema.String),
})
export const RegistryPackage = Schema.Struct({
  version: Schema.String,
  packagePath: Schema.String,
  gitHead: Schema.NullOr(Schema.String),
  resolution: Schema.NullOr(PackageResolution),
  files: Schema.Array(Schema.String),
  entrypoints: Schema.Array(Entrypoint),
})
export const InstalledPackage = Schema.Struct({
  name: PackageName,
  expectedVersion: Schema.String,
  declaredVersion: Schema.NullOr(Schema.String),
  status: InstallationStatus,
  targetSource: Schema.Literals(["pinned", "installed-external"]),
  targetVersion: Schema.NullOr(Schema.String),
  targetPackagePath: Schema.NullOr(Schema.String),
  targetFiles: Schema.Array(Schema.String),
  targetEntrypoints: Schema.Array(Entrypoint),
  registryPackage: Schema.NullOr(RegistryPackage),
  registryMatchesPinnedRevision: Schema.NullOr(Schema.Boolean),
  expandedEntrypoints: Schema.Array(ExpandedEntrypoint),
})
export const ExpoInstallation = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  expoRevision: Schema.String,
  lockfileHash: Schema.String,
  packages: Schema.Array(InstalledPackage),
})

export const ExportKind = Schema.Literals([
  "value",
  "type",
  "value-and-type",
  "default",
  "opaque-module",
])
export const SurfaceExport = Schema.Struct({
  id: SurfaceId,
  package: PackageName,
  subpath: Subpath,
  name: ExportName,
  kind: ExportKind,
  platforms: Schema.Array(Schema.String),
  declarationPaths: Schema.Array(Schema.String),
})
export const SurfaceSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  catalogFingerprint: Schema.String,
  fingerprint: Schema.String,
  exports: Schema.Array(SurfaceExport),
})

export const OwnershipOverride = Schema.Struct({
  package: PackageName,
  subpath: Subpath,
  export: Schema.NullOr(ExportName),
  status: Schema.Literals(["effect", "fallback", "unsupported", "intentional-divergence"]),
  replacement: Schema.NullOr(Schema.String),
  reason: Schema.String,
  issue: Schema.String,
})
export const Ownership = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  overrides: Schema.Array(OwnershipOverride),
})
export const OwnershipEntry = Schema.Struct({
  surfaceId: SurfaceId,
  owner: Schema.Literals([
    "upstream",
    "effect",
    "fallback",
    "unsupported",
    "intentional-divergence",
  ]),
  reason: Schema.NullOr(Schema.String),
  issue: Schema.NullOr(Schema.String),
})
export const OwnershipLedger = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  surfaceFingerprint: Schema.String,
  fingerprint: Schema.String,
  entries: Schema.Array(OwnershipEntry),
})
export const SurfaceLock = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  surfaceFingerprint: Schema.String,
  surfaceIds: Schema.Array(SurfaceId),
})

export const Expectation = Schema.Struct({
  caseId: TestCaseId,
  platforms: Schema.Array(Schema.String),
  expected: Schema.Literals(["fail", "skip", "timeout", "crash"]),
  reason: Schema.String,
  issue: Schema.String,
})
export const Expectations = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  entries: Schema.Array(Expectation),
})

export const Runner = Schema.Literals([
  "jest",
  "node-test",
  "bun-test",
  "expo-jasmine",
  "xctest",
  "gradle-unit",
  "gradle-instrumentation",
  "maestro",
  "playwright",
  "detox",
  "workflow",
])
export const ExecutionRunner = Schema.Literals([
  "native-app",
  "web-app",
  "javascript-runner",
  "xctest",
  "gradle",
  "build",
  "unsupported",
])
export const Suite = Schema.Struct({
  id: SuiteId,
  platforms: Schema.Array(Schema.String),
  match: Schema.Array(Schema.String),
  runner: Runner,
  kind: Schema.Literals(["test", "configuration", "workflow"]),
  executability: Schema.Literals([
    "runnable",
    "runtime-discovery-required",
    "delegated",
    "non-executable",
  ]),
  reason: Schema.NullOr(Schema.String),
})
export const Suites = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  expoRevision: Schema.String,
  suites: Schema.Array(Suite),
})
export const TestSource = Schema.Struct({
  id: TestSourceId,
  suiteId: SuiteId,
  runner: Runner,
  path: Schema.String,
  kind: Schema.Literals(["test", "configuration", "workflow"]),
  platforms: Schema.Array(Schema.String),
  executability: Schema.Literals([
    "runnable",
    "runtime-discovery-required",
    "delegated",
    "non-executable",
  ]),
  caseEvidence: Schema.optional(Schema.Literals(["static", "dynamic", "none"])),
  reason: Schema.NullOr(Schema.String),
})
export const TestCase = Schema.Struct({
  id: TestCaseId,
  sourceId: TestSourceId,
  name: Schema.String,
  discovery: Schema.Literals(["static", "runtime"]),
})
export const CorpusSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  fingerprint: Schema.String,
  sources: Schema.Array(TestSource),
  cases: Schema.Array(TestCase),
})

export const RegistrySource = Schema.Struct({
  sourceId: TestSourceId,
  path: Schema.String,
  caseIds: Schema.Array(TestCaseId),
  runner: Runner,
  execution: ExecutionRunner,
  platforms: Schema.Array(Schema.String),
  executability: Schema.Literals([
    "runnable",
    "runtime-discovery-required",
    "delegated",
    "non-executable",
  ]),
  registration: Schema.Literals(["eager", "lazy", "external"]),
  authority: Schema.Literals(["upstream-selected", "supplemental"]),
  runtimeName: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
})
export const RegistryMetadata = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  corpusFingerprint: Schema.String,
  surfaceFingerprint: Schema.String,
  trackedSpecifiers: Schema.Array(Schema.String),
  nativeE2eSourceIds: Schema.Array(TestSourceId),
  sources: Schema.Array(RegistrySource),
})

export const Artifact = Schema.Struct({
  id: ArtifactId,
  path: Schema.String,
  mediaType: Schema.String,
  size: Schema.Int,
  hash: ContentHash,
})
export const BuildRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: BuildId,
  mode: Mode,
  platform: Platform,
  expoRevision: Schema.String,
  candidateRevision: Schema.NullOr(Schema.String),
  configurationHash: ContentHash,
  bundleHash: ContentHash,
  nativeBinaryHash: Schema.NullOr(ContentHash),
  artifacts: Schema.Array(Artifact),
})
export const DeviceRecord = Schema.Struct({
  id: DeviceId,
  platform: Platform,
  kind: Schema.Literals(["host", "browser", "simulator", "emulator", "physical", "ci"]),
  name: Schema.String,
  osVersion: Schema.NullOr(Schema.String),
  runtimeVersion: Schema.NullOr(Schema.String),
})
/**
 * One independently executable compatibility unit. This is harness metadata;
 * it is deliberately not serialized into an app URL or passed to the app.
 */
export const ExecutionUnit = Schema.Struct({
  id: Schema.String,
  runner: ExecutionRunner,
  platform: Platform,
  sourceId: TestSourceId,
})
export const RunPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: RunId,
  buildId: BuildId,
  platform: Platform,
  unit: ExecutionUnit,
  timeoutMillis: Schema.Int,
  retries: Schema.Int,
})
export const InfrastructureOutcome = Schema.Union([
  Schema.TaggedStruct("succeeded", {}),
  Schema.TaggedStruct("build-failed", { message: Schema.String }),
  Schema.TaggedStruct("runner-failed", { message: Schema.String }),
  Schema.TaggedStruct("device-unavailable", { message: Schema.String }),
  Schema.TaggedStruct("timed-out", { phase: Schema.String, timeoutMillis: Schema.Int }),
  Schema.TaggedStruct("crashed", {
    signal: Schema.NullOr(Schema.String),
    exitCode: Schema.NullOr(Schema.Int),
  }),
  Schema.TaggedStruct("protocol-error", { message: Schema.String }),
  Schema.TaggedStruct("cancelled", { reason: Schema.String }),
])
const Passed = Schema.TaggedStruct("passed", { durationMillis: Schema.Int })
const Failed = Schema.TaggedStruct("failed", {
  durationMillis: Schema.Int,
  message: Schema.String,
  stack: Schema.NullOr(Schema.String),
})
const Skipped = Schema.TaggedStruct("skipped", { reason: Schema.String })
const Timeout = Schema.TaggedStruct("timeout", { timeoutMillis: Schema.Int })
const Crashed = Schema.TaggedStruct("crashed", {
  signal: Schema.NullOr(Schema.String),
  exitCode: Schema.NullOr(Schema.Int),
})
const NotRun = Schema.TaggedStruct("not-run", { reason: Schema.String })
export const CaseOutcome = Schema.Union([Passed, Failed, Skipped, Timeout, Crashed, NotRun])
export const CaseResult = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: RunId,
  caseId: TestCaseId,
  attempt: Schema.Int,
  outcome: CaseOutcome,
  artifacts: Schema.Array(ArtifactId),
})
export const AppRunSummary = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: RunId,
  buildId: BuildId,
  mode: Mode,
  results: Schema.Array(CaseResult),
  runtimeDiscoveredCaseIds: Schema.Array(TestCaseId),
})
export const ProcessObservation = Schema.Struct({
  sequence: Schema.Int,
  timestampMillis: Schema.Int,
  stream: Schema.Literals(["stdout", "stderr", "supervisor"]),
  text: Schema.String,
})
export const RunAttempt = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: AttemptId,
  runId: RunId,
  attempt: Schema.Int,
  startedAtMillis: Schema.Int,
  finishedAtMillis: Schema.Int,
  infrastructure: InfrastructureOutcome,
  results: Schema.Array(CaseResult),
  observations: Schema.Array(ProcessObservation),
  artifacts: Schema.Array(ArtifactId),
})
export const RunRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  plan: RunPlan,
  build: BuildRecord,
  device: DeviceRecord,
  runtimeDiscoveredCaseIds: Schema.Array(TestCaseId),
  attempts: Schema.Array(RunAttempt),
  finalInfrastructure: InfrastructureOutcome,
})
export const BuildAttempt = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: AttemptId,
  buildId: BuildId,
  startedAtMillis: Schema.Int,
  finishedAtMillis: Schema.Int,
  infrastructure: InfrastructureOutcome,
  artifacts: Schema.Array(ArtifactId),
})
export const RuntimeCaseObservation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: ObservationId,
  runId: RunId,
  buildId: BuildId,
  sourceId: TestSourceId,
  caseId: TestCaseId,
  name: Schema.String,
  platform: Platform,
})
export const ExportObservation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: ObservationId,
  runId: RunId,
  buildId: BuildId,
  mode: Mode,
  platform: Platform,
  package: PackageName,
  subpath: Subpath,
  exports: Schema.Array(ExportName),
  outcome: Schema.Literals(["loaded", "failed", "native-unavailable"]),
  detail: Schema.NullOr(Schema.String),
})
const ResolutionSourceFile = Schema.Struct({
  kind: Schema.Literal("source-file"),
  filePath: Schema.String,
})
const ResolutionAssetFiles = Schema.Struct({
  kind: Schema.Literal("asset-files"),
  filePaths: Schema.Array(Schema.String),
})
const ResolutionEmpty = Schema.Struct({ kind: Schema.Literal("empty") })
const ResolutionFailure = Schema.Struct({
  kind: Schema.Literal("failure"),
  name: Schema.String,
  message: Schema.String,
})
export const ResolutionOutcome = Schema.Union([
  ResolutionSourceFile,
  ResolutionAssetFiles,
  ResolutionEmpty,
  ResolutionFailure,
])
export const ResolutionObservation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: ObservationId,
  runId: RunId,
  buildId: BuildId,
  ownershipFingerprint: Schema.NullOr(Schema.String),
  mode: Mode,
  specifier: Schema.String,
  replacement: Schema.NullOr(Schema.String),
  decision: Schema.Literals(["upstream", "candidate", "self-upstream", "unmanaged"]),
  originModulePath: Schema.String,
  originPackage: Schema.NullOr(Schema.String),
  platform: Schema.NullOr(Platform),
  environment: Schema.NullOr(Schema.String),
  isEsmImport: Schema.NullOr(Schema.Boolean),
  conditions: Schema.Array(Schema.String),
  mainFields: Schema.Array(Schema.String),
  sourceExtensions: Schema.Array(Schema.String),
  preferNativePlatform: Schema.Boolean,
  outcome: ResolutionOutcome,
  resolvedTarget: Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  resolvedPackage: Schema.NullOr(Schema.String),
})
export const DiscoveryRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: RunId,
  runtimeCases: Schema.Array(RuntimeCaseObservation),
  resolutions: Schema.Array(ResolutionObservation),
  exports: Schema.Array(ExportObservation),
})
export const Comparison = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  caseId: TestCaseId,
  upstreamRunId: RunId,
  candidateRunId: RunId,
  result: Schema.Literals([
    "match",
    "mismatch",
    "upstream-failed",
    "expected-divergence",
    "missing-evidence",
  ]),
  detail: Schema.NullOr(Schema.String),
})
export const Report = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  catalogFingerprint: ContentHash,
  builds: Schema.Array(BuildId),
  runs: Schema.Array(RunId),
  comparisons: Schema.Array(Comparison),
  artifacts: Schema.Array(Artifact),
})

export type Catalog = Schema.Schema.Type<typeof Catalog>
export type Artifact = Schema.Schema.Type<typeof Artifact>
export type AppRunSummary = Schema.Schema.Type<typeof AppRunSummary>
export type BuildAttempt = Schema.Schema.Type<typeof BuildAttempt>
export type BuildId = Schema.Schema.Type<typeof BuildId>
export type BuildRecord = Schema.Schema.Type<typeof BuildRecord>
export type CaseResult = Schema.Schema.Type<typeof CaseResult>
export type CatalogSnapshot = Schema.Schema.Type<typeof CatalogSnapshot>
export type ContentHash = Schema.Schema.Type<typeof ContentHash>
export type CorpusSnapshot = Schema.Schema.Type<typeof CorpusSnapshot>
export type DeviceRecord = Schema.Schema.Type<typeof DeviceRecord>
export type DiscoveryRecord = Schema.Schema.Type<typeof DiscoveryRecord>
export type Entrypoint = Schema.Schema.Type<typeof Entrypoint>
export type ExpandedEntrypoint = Schema.Schema.Type<typeof ExpandedEntrypoint>
export type ExportKind = Schema.Schema.Type<typeof ExportKind>
export type ExportObservation = Schema.Schema.Type<typeof ExportObservation>
export type ExpoInstallation = Schema.Schema.Type<typeof ExpoInstallation>
export type Expectations = Schema.Schema.Type<typeof Expectations>
export type InstalledPackage = Schema.Schema.Type<typeof InstalledPackage>
export type InfrastructureOutcome = Schema.Schema.Type<typeof InfrastructureOutcome>
export type Mode = Schema.Schema.Type<typeof Mode>
export type NativeRegistration = Schema.Schema.Type<typeof NativeRegistration>
export type Ownership = Schema.Schema.Type<typeof Ownership>
export type OwnershipOverride = Schema.Schema.Type<typeof OwnershipOverride>
export type OwnershipLedger = Schema.Schema.Type<typeof OwnershipLedger>
export type Package = Schema.Schema.Type<typeof Package>
export type Platform = Schema.Schema.Type<typeof Platform>
export type PackageName = Schema.Schema.Type<typeof PackageName>
export type PackageResolution = Schema.Schema.Type<typeof PackageResolution>
export type PackageRole = Schema.Schema.Type<typeof PackageRole>
export type ProcessObservation = Schema.Schema.Type<typeof ProcessObservation>
export type RegistryMetadata = Schema.Schema.Type<typeof RegistryMetadata>
export type RegistryPackage = Schema.Schema.Type<typeof RegistryPackage>
export type ResolutionBranch = Schema.Schema.Type<typeof ResolutionBranch>
export type ResolutionObservation = Schema.Schema.Type<typeof ResolutionObservation>
export type RoleEvidence = Schema.Schema.Type<typeof RoleEvidence>
export type Runner = Schema.Schema.Type<typeof Runner>
export type RunId = Schema.Schema.Type<typeof RunId>
export type RunAttempt = Schema.Schema.Type<typeof RunAttempt>
export type RunPlan = Schema.Schema.Type<typeof RunPlan>
export type ExecutionUnit = Schema.Schema.Type<typeof ExecutionUnit>
export type RunRecord = Schema.Schema.Type<typeof RunRecord>
export type RuntimeCaseObservation = Schema.Schema.Type<typeof RuntimeCaseObservation>
export type Subpath = Schema.Schema.Type<typeof Subpath>
export type SurfaceExport = Schema.Schema.Type<typeof SurfaceExport>
export type SurfaceLock = Schema.Schema.Type<typeof SurfaceLock>
export type SurfaceSnapshot = Schema.Schema.Type<typeof SurfaceSnapshot>
export type TestCase = Schema.Schema.Type<typeof TestCase>
export type TestCaseId = Schema.Schema.Type<typeof TestCaseId>
export type TestSource = Schema.Schema.Type<typeof TestSource>
export type TestSourceId = Schema.Schema.Type<typeof TestSourceId>
