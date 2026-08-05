import * as Schema from "effect/Schema"

/** Branded Expo package name used in catalog and evidence records. */
export const PackageName = Schema.String.pipe(Schema.brand("@better-native/PackageName"))
/** Branded package subpath, including `.` for a package root. */
export const Subpath = Schema.String.pipe(Schema.brand("@better-native/Subpath"))
/** Branded runtime or type export name from an Expo entrypoint. */
export const ExportName = Schema.String.pipe(Schema.brand("@better-native/ExportName"))
/** Stable identifier for one discovered Expo surface export. */
export const SurfaceId = Schema.String.pipe(Schema.brand("@better-native/SurfaceId"))
/** Stable identifier for a configured test suite. */
export const SuiteId = Schema.String.pipe(Schema.brand("@better-native/SuiteId"))
/** Stable identifier for one discovered test source. */
export const TestSourceId = Schema.String.pipe(Schema.brand("@better-native/TestSourceId"))
/** Stable identifier for one discovered or executed test case. */
export const TestCaseId = Schema.String.pipe(Schema.brand("@better-native/TestCaseId"))
const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
/**
 * Returns whether a value is safe to use as one evidence path segment.
 *
 * @param value - Candidate identifier.
 * @returns Whether the value is non-empty and contains only the permitted characters.
 */
export const isSafePathSegment = (value: string): boolean => safePathSegmentPattern.test(value)
const SafePathSegment = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(isSafePathSegment, {
      expected: "a safe non-empty path segment",
    }),
  ),
)
/** Branded identifier for one build materialization. */
export const BuildId = SafePathSegment.pipe(Schema.brand("@better-native/BuildId"))
/** Branded identifier for one supervised run. */
export const RunId = SafePathSegment.pipe(Schema.brand("@better-native/RunId"))
/** Branded identifier for one persisted artifact. */
export const ArtifactId = Schema.String.pipe(Schema.brand("@better-native/ArtifactId"))
/** Branded identifier for one runtime observation. */
export const ObservationId = Schema.String.pipe(Schema.brand("@better-native/ObservationId"))
/** Branded identifier for one build or run attempt. */
export const AttemptId = Schema.String.pipe(Schema.brand("@better-native/AttemptId"))
/** Branded identifier for a device, simulator, emulator, or browser. */
export const DeviceId = Schema.String.pipe(Schema.brand("@better-native/DeviceId"))
/** Branded content hash used to bind evidence to its bytes. */
export const ContentHash = Schema.String.pipe(Schema.brand("@better-native/ContentHash"))

/** Execution platforms understood by the catalog and supervisors. */
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
/** Selects the pinned upstream implementation or the candidate replacement. */
export const Mode = Schema.Literals(["upstream", "candidate"])

/** Classifies an Expo entrypoint by the work it performs. */
export const EntrypointKind = Schema.Literals([
  "runtime",
  "build-time",
  "server",
  "metadata",
  "asset",
])
/** Source from which an entrypoint resolution was derived. */
export const ResolutionSource = Schema.Literals(["exports", "manifest", "convention"])
/** Raw package-export resolution value retained for diagnostics. */
export const Resolution = Schema.Struct({ source: ResolutionSource, value: Schema.Json })
/** One conditional branch in a package-export resolution. */
export const ResolutionBranch = Schema.Struct({
  conditions: Schema.Array(Schema.String),
  fallback: Schema.Array(Schema.Int),
  target: Schema.NullOr(Schema.String),
  platforms: Schema.Array(Schema.String),
})
/** Discovered package subpath and its platform-aware resolution. */
export const Entrypoint = Schema.Struct({
  subpath: Subpath,
  kind: EntrypointKind,
  pattern: Schema.Boolean,
  resolution: Resolution,
  resolutionBranches: Schema.Array(ResolutionBranch),
})

/** Role assigned to a package in the pinned Expo catalog. */
export const PackageRole = Schema.Literals([
  "workspace",
  "sdk",
  "bundled",
  "native",
  "config-plugin",
  "cli",
  "server",
])
/** Evidence explaining why a package received a catalog role. */
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
/** Native registration metadata discovered for an Expo package. */
export const NativeRegistration = Schema.Union([
  NativeRegistrationConfig,
  NativeRegistrationTemplate,
])
/** One package, its entrypoints, roles, and native registration metadata. */
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
/** Complete package catalog derived from the pinned Expo checkout. */
export const Catalog = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  expoRevision: Schema.String,
  effectRevision: Schema.String,
  packages: Schema.Array(Package),
})
/** Catalog plus its deterministic content fingerprint. */
export const CatalogSnapshot = Schema.Struct({ catalog: Catalog, fingerprint: Schema.String })

/** Installation status for one expected Expo package. */
export const InstallationStatus = Schema.Literals([
  "valid",
  "missing",
  "not-declared",
  "version-mismatch",
  "unlocked",
])
/** Registry resolution metadata retained alongside an installed package. */
export const PackageResolution = Schema.Struct({
  version: Schema.String,
  integrity: Schema.NullOr(Schema.String),
})
/** Concrete files matched when a wildcard entrypoint is expanded. */
export const ExpandedEntrypoint = Schema.Struct({
  declarationSource: Schema.Literals(["pinned", "installed-external"]),
  declaredSubpath: Subpath,
  subpath: Subpath,
  matchedFiles: Schema.Array(Schema.String),
})
/** Published package metadata used for bundled external dependencies. */
export const RegistryPackage = Schema.Struct({
  version: Schema.String,
  packagePath: Schema.String,
  gitHead: Schema.NullOr(Schema.String),
  resolution: Schema.NullOr(PackageResolution),
  files: Schema.Array(Schema.String),
  entrypoints: Schema.Array(Entrypoint),
})
/** Validation result for one package in the prepared Expo installation. */
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
/** Complete pinned-installation inspection artifact. */
export const ExpoInstallation = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  expoRevision: Schema.String,
  lockfileHash: Schema.String,
  packages: Schema.Array(InstalledPackage),
})

/** Kind of public export represented in the compatibility surface. */
export const ExportKind = Schema.Literals([
  "value",
  "type",
  "value-and-type",
  "default",
  "opaque-module",
])
/** One package export in the locked Expo compatibility denominator. */
export const SurfaceExport = Schema.Struct({
  id: SurfaceId,
  package: PackageName,
  subpath: Subpath,
  name: ExportName,
  kind: ExportKind,
  platforms: Schema.Array(Schema.String),
  declarationPaths: Schema.Array(Schema.String),
})
/** Versioned export surface and its deterministic fingerprint. */
export const SurfaceSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  catalogFingerprint: Schema.String,
  fingerprint: Schema.String,
  exports: Schema.Array(SurfaceExport),
})

/** Reviewed override for one package, subpath, or export ownership decision. */
export const OwnershipOverride = Schema.Struct({
  package: PackageName,
  subpath: Subpath,
  export: Schema.NullOr(ExportName),
  status: Schema.Literals(["effect", "fallback", "unsupported", "intentional-divergence"]),
  replacement: Schema.NullOr(Schema.String),
  reason: Schema.String,
  issue: Schema.String,
})
/** Reviewed ownership configuration loaded from compatibility policy. */
export const Ownership = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  overrides: Schema.Array(OwnershipOverride),
})
/** Materialized owner and rationale for one discovered surface export. */
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
/** Complete ownership ledger generated from the surface and overrides. */
export const OwnershipLedger = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  surfaceFingerprint: Schema.String,
  fingerprint: Schema.String,
  entries: Schema.Array(OwnershipEntry),
})
/** Reviewed lock preventing silent compatibility-surface drift. */
export const SurfaceLock = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  surfaceFingerprint: Schema.String,
  surfaceIds: Schema.Array(SurfaceId),
})

/** Reviewed expected failure or skip for a case on selected platforms. */
export const Expectation = Schema.Struct({
  caseId: TestCaseId,
  platforms: Schema.Array(Schema.String),
  expected: Schema.Literals(["fail", "skip", "timeout", "crash"]),
  reason: Schema.String,
  issue: Schema.String,
})
/** Versioned collection of intentional case-level expectations. */
export const Expectations = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  entries: Schema.Array(Expectation),
})

/** External or in-app runner family used to execute a source. */
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
/** Harness execution mode selected for a discovered source. */
export const ExecutionRunner = Schema.Literals([
  "native-app",
  "web-app",
  "javascript-runner",
  "xctest",
  "gradle",
  "build",
  "unsupported",
])
/** Declarative rule describing a family of Expo tests. */
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
/** Versioned suite-discovery configuration derived from the pinned checkout. */
export const Suites = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  expoRevision: Schema.String,
  suites: Schema.Array(Suite),
})
/** One source file selected by suite discovery. */
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
/** One statically or dynamically discovered case in a test source. */
export const TestCase = Schema.Struct({
  id: TestCaseId,
  sourceId: TestSourceId,
  name: Schema.String,
  discovery: Schema.Literals(["static", "runtime"]),
})
/** Complete discovered test denominator and its fingerprint. */
export const CorpusSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  fingerprint: Schema.String,
  sources: Schema.Array(TestSource),
  cases: Schema.Array(TestCase),
})

/** Generated app-registry entry for one executable or delegated source. */
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
/** Metadata consumed by the generated compatibility application. */
export const RegistryMetadata = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  corpusFingerprint: Schema.String,
  surfaceFingerprint: Schema.String,
  trackedSpecifiers: Schema.Array(Schema.String),
  nativeE2eSourceIds: Schema.Array(TestSourceId),
  sources: Schema.Array(RegistrySource),
})

/** Immutable file produced by a build or run. */
export const Artifact = Schema.Struct({
  id: ArtifactId,
  path: Schema.String,
  mediaType: Schema.String,
  size: Schema.Int,
  hash: ContentHash,
})
/** Timing evidence for one build phase. */
export const BuildPhaseEvidence = Schema.Struct({
  name: Schema.String,
  startedAtMillis: Schema.Int,
  finishedAtMillis: Schema.Int,
  durationMillis: Schema.Int,
})
/** Hit/miss evidence for one build cache. */
export const BuildCacheEvidence = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(["hit", "miss", "partial", "disabled", "unknown"]),
  key: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
})
/** Build timing and cache evidence retained for diagnostics. */
export const BuildPerformanceEvidence = Schema.Struct({
  architecture: Schema.String,
  phases: Schema.Array(BuildPhaseEvidence),
  caches: Schema.Array(BuildCacheEvidence),
})
/** Provenance and validation state for a reused native artifact. */
export const NativeArtifactEvidence = Schema.Struct({
  cacheKey: Schema.String,
  source: Schema.Literals(["full-build", "native-cache"]),
  sourceBuildId: BuildId,
  artifactHash: ContentHash,
  validated: Schema.Boolean,
})
/** Immutable build result bound to a pinned Expo and candidate revision. */
export const BuildRecord = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  id: BuildId,
  mode: Mode,
  platform: Platform,
  expoRevision: Schema.String,
  candidateRevision: Schema.NullOr(Schema.String),
  configurationHash: ContentHash,
  bundleHash: ContentHash,
  nativeBinaryHash: Schema.NullOr(ContentHash),
  nativeFingerprint: Schema.NullOr(Schema.String),
  toolchainFingerprint: Schema.NullOr(ContentHash),
  buildDecision: Schema.Literals(["bundle", "full-build", "repack"]),
  nativeArtifact: Schema.NullOr(NativeArtifactEvidence),
  performance: BuildPerformanceEvidence,
  artifacts: Schema.Array(Artifact),
})
/** Device or browser identity used for one compatibility run. */
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
/** Executable run request tying a build to one execution unit. */
export const RunPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: RunId,
  buildId: BuildId,
  platform: Platform,
  unit: ExecutionUnit,
  timeoutMillis: Schema.Int,
  retries: Schema.Int,
})
/** Outcome of the harness infrastructure independent of case behavior. */
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
/** Behavioral result for one compatibility case. */
export const CaseOutcome = Schema.Union([Passed, Failed, Skipped, Timeout, Crashed, NotRun])
/** Case result recorded by an upstream or candidate run. */
export const CaseResult = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: RunId,
  caseId: TestCaseId,
  attempt: Schema.Int,
  outcome: CaseOutcome,
  artifacts: Schema.Array(ArtifactId),
})
/** Summary sent by the compatibility app before evidence is finalized. */
export const AppRunSummary = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: RunId,
  buildId: BuildId,
  mode: Mode,
  results: Schema.Array(CaseResult),
  runtimeDiscoveredCaseIds: Schema.Array(TestCaseId),
})
/** Bounded stdout, stderr, or supervisor observation. */
export const ProcessObservation = Schema.Struct({
  sequence: Schema.Int,
  timestampMillis: Schema.Int,
  stream: Schema.Literals(["stdout", "stderr", "supervisor"]),
  text: Schema.String,
})
/** One immutable attempt within a supervised run. */
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
/** Complete immutable run evidence, including all attempts. */
export const RunRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  plan: RunPlan,
  build: BuildRecord,
  device: DeviceRecord,
  runtimeDiscoveredCaseIds: Schema.Array(TestCaseId),
  attempts: Schema.Array(RunAttempt),
  finalInfrastructure: InfrastructureOutcome,
})
/** One build attempt and its infrastructure outcome. */
export const BuildAttempt = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: AttemptId,
  buildId: BuildId,
  startedAtMillis: Schema.Int,
  finishedAtMillis: Schema.Int,
  infrastructure: InfrastructureOutcome,
  artifacts: Schema.Array(ArtifactId),
})
/** Case discovered at runtime by the compatibility app. */
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
/** Runtime load result for one Expo package export. */
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
/** Result of resolving a module specifier in the instrumented app. */
export const ResolutionOutcome = Schema.Union([
  ResolutionSourceFile,
  ResolutionAssetFiles,
  ResolutionEmpty,
  ResolutionFailure,
])
/** Full Metro resolution decision and resulting target. */
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
/** Runtime discovery observations collected during a run. */
export const DiscoveryRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: RunId,
  runtimeCases: Schema.Array(RuntimeCaseObservation),
  resolutions: Schema.Array(ResolutionObservation),
  exports: Schema.Array(ExportObservation),
})
/** Differential verdict for one upstream/candidate test case. */
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
/** Aggregate compatibility report over builds, runs, and comparisons. */
export const Report = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  expoRevision: Schema.String,
  catalogFingerprint: ContentHash,
  builds: Schema.Array(BuildId),
  runs: Schema.Array(RunId),
  comparisons: Schema.Array(Comparison),
  artifacts: Schema.Array(Artifact),
})

/** Decoded value accepted by {@link Catalog}. */
export type Catalog = Schema.Schema.Type<typeof Catalog>
/** Decoded value accepted by {@link Artifact}. */
export type Artifact = Schema.Schema.Type<typeof Artifact>
/** Decoded app summary accepted by {@link AppRunSummary}. */
export type AppRunSummary = Schema.Schema.Type<typeof AppRunSummary>
/** Decoded build attempt accepted by {@link BuildAttempt}. */
export type BuildAttempt = Schema.Schema.Type<typeof BuildAttempt>
/** Decoded safe build identifier accepted by {@link BuildId}. */
export type BuildId = Schema.Schema.Type<typeof BuildId>
/** Decoded build evidence accepted by {@link BuildRecord}. */
export type BuildRecord = Schema.Schema.Type<typeof BuildRecord>
/** Decoded case result accepted by {@link CaseResult}. */
export type CaseResult = Schema.Schema.Type<typeof CaseResult>
/** Decoded catalog snapshot accepted by {@link CatalogSnapshot}. */
export type CatalogSnapshot = Schema.Schema.Type<typeof CatalogSnapshot>
/** Decoded content hash accepted by {@link ContentHash}. */
export type ContentHash = Schema.Schema.Type<typeof ContentHash>
/** Decoded test corpus accepted by {@link CorpusSnapshot}. */
export type CorpusSnapshot = Schema.Schema.Type<typeof CorpusSnapshot>
/** Decoded device record accepted by {@link DeviceRecord}. */
export type DeviceRecord = Schema.Schema.Type<typeof DeviceRecord>
/** Decoded discovery record accepted by {@link DiscoveryRecord}. */
export type DiscoveryRecord = Schema.Schema.Type<typeof DiscoveryRecord>
/** Decoded entrypoint accepted by {@link Entrypoint}. */
export type Entrypoint = Schema.Schema.Type<typeof Entrypoint>
/** Decoded wildcard expansion accepted by {@link ExpandedEntrypoint}. */
export type ExpandedEntrypoint = Schema.Schema.Type<typeof ExpandedEntrypoint>
/** Decoded export kind accepted by {@link ExportKind}. */
export type ExportKind = Schema.Schema.Type<typeof ExportKind>
/** Decoded export observation accepted by {@link ExportObservation}. */
export type ExportObservation = Schema.Schema.Type<typeof ExportObservation>
/** Decoded installation report accepted by {@link ExpoInstallation}. */
export type ExpoInstallation = Schema.Schema.Type<typeof ExpoInstallation>
/** Decoded expectations accepted by {@link Expectations}. */
export type Expectations = Schema.Schema.Type<typeof Expectations>
/** Decoded installed-package record accepted by {@link InstalledPackage}. */
export type InstalledPackage = Schema.Schema.Type<typeof InstalledPackage>
/** Decoded infrastructure outcome accepted by {@link InfrastructureOutcome}. */
export type InfrastructureOutcome = Schema.Schema.Type<typeof InfrastructureOutcome>
/** Decoded upstream/candidate mode accepted by {@link Mode}. */
export type Mode = Schema.Schema.Type<typeof Mode>
/** Decoded native registration accepted by {@link NativeRegistration}. */
export type NativeRegistration = Schema.Schema.Type<typeof NativeRegistration>
/** Decoded ownership configuration accepted by {@link Ownership}. */
export type Ownership = Schema.Schema.Type<typeof Ownership>
/** Decoded ownership override accepted by {@link OwnershipOverride}. */
export type OwnershipOverride = Schema.Schema.Type<typeof OwnershipOverride>
/** Decoded ownership ledger accepted by {@link OwnershipLedger}. */
export type OwnershipLedger = Schema.Schema.Type<typeof OwnershipLedger>
/** Decoded package record accepted by {@link Package}. */
export type Package = Schema.Schema.Type<typeof Package>
/** Decoded platform value accepted by {@link Platform}. */
export type Platform = Schema.Schema.Type<typeof Platform>
/** Decoded package name accepted by {@link PackageName}. */
export type PackageName = Schema.Schema.Type<typeof PackageName>
/** Decoded registry resolution accepted by {@link PackageResolution}. */
export type PackageResolution = Schema.Schema.Type<typeof PackageResolution>
/** Decoded package role accepted by {@link PackageRole}. */
export type PackageRole = Schema.Schema.Type<typeof PackageRole>
/** Decoded process observation accepted by {@link ProcessObservation}. */
export type ProcessObservation = Schema.Schema.Type<typeof ProcessObservation>
/** Decoded registry metadata accepted by {@link RegistryMetadata}. */
export type RegistryMetadata = Schema.Schema.Type<typeof RegistryMetadata>
/** Decoded registry package accepted by {@link RegistryPackage}. */
export type RegistryPackage = Schema.Schema.Type<typeof RegistryPackage>
/** Decoded resolution branch accepted by {@link ResolutionBranch}. */
export type ResolutionBranch = Schema.Schema.Type<typeof ResolutionBranch>
/** Decoded resolution observation accepted by {@link ResolutionObservation}. */
export type ResolutionObservation = Schema.Schema.Type<typeof ResolutionObservation>
/** Decoded role evidence accepted by {@link RoleEvidence}. */
export type RoleEvidence = Schema.Schema.Type<typeof RoleEvidence>
/** Decoded runner value accepted by {@link Runner}. */
export type Runner = Schema.Schema.Type<typeof Runner>
/** Decoded safe run identifier accepted by {@link RunId}. */
export type RunId = Schema.Schema.Type<typeof RunId>
/** Decoded run attempt accepted by {@link RunAttempt}. */
export type RunAttempt = Schema.Schema.Type<typeof RunAttempt>
/** Decoded run plan accepted by {@link RunPlan}. */
export type RunPlan = Schema.Schema.Type<typeof RunPlan>
/** Decoded execution unit accepted by {@link ExecutionUnit}. */
export type ExecutionUnit = Schema.Schema.Type<typeof ExecutionUnit>
/** Decoded run evidence accepted by {@link RunRecord}. */
export type RunRecord = Schema.Schema.Type<typeof RunRecord>
/** Decoded runtime case observation accepted by {@link RuntimeCaseObservation}. */
export type RuntimeCaseObservation = Schema.Schema.Type<typeof RuntimeCaseObservation>
/** Decoded package subpath accepted by {@link Subpath}. */
export type Subpath = Schema.Schema.Type<typeof Subpath>
/** Decoded surface export accepted by {@link SurfaceExport}. */
export type SurfaceExport = Schema.Schema.Type<typeof SurfaceExport>
/** Decoded surface lock accepted by {@link SurfaceLock}. */
export type SurfaceLock = Schema.Schema.Type<typeof SurfaceLock>
/** Decoded surface snapshot accepted by {@link SurfaceSnapshot}. */
export type SurfaceSnapshot = Schema.Schema.Type<typeof SurfaceSnapshot>
/** Decoded test case accepted by {@link TestCase}. */
export type TestCase = Schema.Schema.Type<typeof TestCase>
/** Decoded test-case identifier accepted by {@link TestCaseId}. */
export type TestCaseId = Schema.Schema.Type<typeof TestCaseId>
/** Decoded test source accepted by {@link TestSource}. */
export type TestSource = Schema.Schema.Type<typeof TestSource>
/** Decoded test-source identifier accepted by {@link TestSourceId}. */
export type TestSourceId = Schema.Schema.Type<typeof TestSourceId>
