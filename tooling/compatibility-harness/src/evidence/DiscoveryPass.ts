import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
  DiscoveryRecord,
  ExportName,
  ObservationId,
  PackageName,
  ResolutionObservation,
  Subpath,
  TestCaseId,
  type AppRunSummary,
  type BuildId,
  type CorpusSnapshot,
  type DiscoveryRecord as DiscoveryRecordType,
  type Mode,
  type Platform,
  type ProcessObservation,
  type RunId,
} from "../Domain.ts"
import { EvidenceStore } from "./EvidenceStore.ts"

const ResolutionEvent = Schema.Struct({
  runId: Schema.String,
  buildId: Schema.String,
  ownershipFingerprint: Schema.NullOr(Schema.String),
  mode: Schema.Literals(["upstream", "candidate"]),
  specifier: Schema.String,
  replacement: Schema.NullOr(Schema.String),
  decision: Schema.Literals(["upstream", "candidate", "self-upstream", "unmanaged"]),
  originModulePath: Schema.String,
  originPackage: Schema.NullOr(Schema.String),
  platform: Schema.NullOr(Schema.String),
  environment: Schema.NullOr(Schema.String),
  isEsmImport: Schema.NullOr(Schema.Boolean),
  conditions: Schema.Array(Schema.String),
  mainFields: Schema.Array(Schema.String),
  sourceExtensions: Schema.Array(Schema.String),
  preferNativePlatform: Schema.Boolean,
  outcome: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("source-file"), filePath: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("asset-files"), filePaths: Schema.Array(Schema.String) }),
    Schema.Struct({ kind: Schema.Literal("empty") }),
    Schema.Struct({ kind: Schema.Literal("failure"), name: Schema.String, message: Schema.String }),
  ]),
  resolvedTarget: Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  resolvedPackage: Schema.NullOr(Schema.String),
})
const ProbeResult = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  specifier: Schema.String,
  outcome: Schema.Literals(["loaded", "failed"]),
  exports: Schema.Array(Schema.String),
  detail: Schema.NullOr(Schema.String),
})

/** Inputs collected from an app run and its supervisor observations. */
export interface DiscoveryInput {
  readonly runId: RunId
  readonly buildId: BuildId
  readonly mode: Mode
  readonly platform: Platform
  readonly corpus: CorpusSnapshot
  readonly summaries: ReadonlyArray<AppRunSummary>
  readonly processObservations: ReadonlyArray<ProcessObservation>
  readonly exportProbeJson: ReadonlyArray<string>
}

/** Signals malformed or inconsistent runtime discovery data. */
export class DiscoveryError extends Data.TaggedError("DiscoveryError")<{
  readonly runId: RunId
  readonly cause: unknown
}> {}

/** Runtime-discovery service that materializes a discovery record. */
export interface Service {
  readonly collect: (input: DiscoveryInput) => Effect.Effect<DiscoveryRecordType, DiscoveryError>
}

/** Effect context tag for the discovery pass. */
export class DiscoveryPass extends Context.Service<DiscoveryPass, Service>()(
  "@better-native/compatibility-harness/DiscoveryPass",
) {}

const sourceForCase = (corpus: CorpusSnapshot, caseId: string) =>
  corpus.sources.find(({ id }) => caseId.startsWith(`${id}#`))

const packageAndSubpath = (specifier: string) => {
  const parts = specifier.split("/")
  const packageLength = specifier.startsWith("@") ? 2 : 1
  const packageName = parts.slice(0, packageLength).join("/")
  const suffix = parts.slice(packageLength).join("/")
  return {
    package: PackageName.make(packageName),
    subpath: Subpath.make(suffix.length === 0 ? "." : `./${suffix}`),
  }
}

const sentinelJson = (text: string, sentinel: string): string | null => {
  const offset = text.indexOf(sentinel)
  return offset < 0 ? null : text.slice(offset + sentinel.length).trim()
}

/**
 * Builds the discovery pass using the shared immutable evidence store.
 *
 * @returns A layer providing {@link DiscoveryPass}.
 */
export const layer: Layer.Layer<DiscoveryPass, never, EvidenceStore> = Layer.effect(
  DiscoveryPass,
  Effect.gen(function* () {
    const evidence = yield* EvidenceStore
    const collect: Service["collect"] = (input) =>
      Effect.gen(function* () {
        const resolutionJson = input.processObservations
          .map(({ text }) => sentinelJson(text, "BETTER_NATIVE_RESOLUTION_V1="))
          .filter((value): value is string => value !== null)
        const resolutions = yield* Effect.forEach(resolutionJson, (json, index) =>
          Effect.try({
            try: () => JSON.parse(json) as unknown,
            catch: (cause) => new DiscoveryError({ runId: input.runId, cause }),
          }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(ResolutionEvent)),
            Effect.flatMap((entry) =>
              Schema.decodeUnknownEffect(ResolutionObservation)({
                schemaVersion: 1,
                id: ObservationId.make(`${input.runId}-resolution-${index + 1}`),
                ...entry,
              }),
            ),
            Effect.mapError((cause) =>
              cause instanceof DiscoveryError
                ? cause
                : new DiscoveryError({ runId: input.runId, cause }),
            ),
          ),
        )
        const probes = yield* Effect.forEach(input.exportProbeJson, (json, index) =>
          Effect.try({
            try: () => JSON.parse(json) as unknown,
            catch: (cause) => new DiscoveryError({ runId: input.runId, cause }),
          }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(ProbeResult)),
            Effect.map((probe) => {
              const location = packageAndSubpath(probe.specifier)
              return {
                schemaVersion: 1 as const,
                id: ObservationId.make(`${input.runId}-export-${index + 1}`),
                runId: input.runId,
                buildId: input.buildId,
                mode: input.mode,
                platform: input.platform,
                ...location,
                exports: probe.exports.map((name) => ExportName.make(name)),
                outcome: probe.outcome,
                detail: probe.detail,
              }
            }),
            Effect.mapError((cause) =>
              cause instanceof DiscoveryError
                ? cause
                : new DiscoveryError({ runId: input.runId, cause }),
            ),
          ),
        )
        const runtimeCaseIds = [
          ...new Set(
            input.summaries.flatMap(({ runtimeDiscoveredCaseIds }) => runtimeDiscoveredCaseIds),
          ),
        ]
        const runtimeCases = runtimeCaseIds.flatMap((caseId, index) => {
          const source = sourceForCase(input.corpus, caseId)
          if (source === undefined) return []
          return [
            {
              schemaVersion: 1 as const,
              id: ObservationId.make(`${input.runId}-case-${index + 1}`),
              runId: input.runId,
              buildId: input.buildId,
              sourceId: source.id,
              caseId: TestCaseId.make(caseId),
              name: caseId.slice(`${source.id}#`.length).replace(/@\d+$/, ""),
              platform: input.platform,
            },
          ]
        })
        const record: DiscoveryRecordType = {
          schemaVersion: 1,
          runId: input.runId,
          runtimeCases,
          resolutions,
          exports: probes.map((probe) => ({
            ...probe,
            outcome: probe.outcome === "loaded" ? "loaded" : "failed",
          })),
        }
        yield* evidence
          .writeJson("runs", input.runId, "discovery.json", DiscoveryRecord, record)
          .pipe(Effect.mapError((cause) => new DiscoveryError({ runId: input.runId, cause })))
        return record
      })
    return DiscoveryPass.of({ collect })
  }),
)
