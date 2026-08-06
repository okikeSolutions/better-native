import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Config from "../Config.ts"
import * as Domain from "../Domain.ts"

export interface ReportArtifact {
  readonly runId: Domain.RunId
  readonly reportPath: string
  readonly modifiedAtMilliseconds: number
}

export type Scope =
  | { readonly kind: "latest" }
  | { readonly kind: "campaign"; readonly campaignId: Domain.CampaignId }
  | { readonly kind: "all" }

/** Failure raised when report flags or retained report artifacts are invalid. */
export class ReportSelectionInvalid extends Data.TaggedError("ReportSelectionInvalid")<{
  readonly reason: "conflicting-flags" | "invalid-campaign" | "no-reports" | "no-campaign-reports"
}> {}

/** Resolves CLI flags; the safe default is exactly the latest retained campaign. */
export const resolveScope = (input: {
  readonly latest: boolean
  readonly campaign: Option.Option<string>
  readonly all: boolean
}): Effect.Effect<Scope, ReportSelectionInvalid> => {
  const campaign = Option.getOrUndefined(input.campaign)
  const selectedCount = Number(input.latest) + Number(input.all) + Number(campaign !== undefined)
  if (selectedCount > 1)
    return Effect.fail(new ReportSelectionInvalid({ reason: "conflicting-flags" }))
  if (input.all) return Effect.succeed({ kind: "all" })
  if (campaign !== undefined) {
    const decoded = Schema.decodeUnknownOption(Domain.CampaignId)(campaign)
    return Option.match(decoded, {
      onNone: () => Effect.fail(new ReportSelectionInvalid({ reason: "invalid-campaign" })),
      onSome: (campaignId) => Effect.succeed({ kind: "campaign", campaignId }),
    })
  }
  return Effect.succeed({ kind: "latest" })
}

const newestFirst = (left: ReportArtifact, right: ReportArtifact) =>
  right.modifiedAtMilliseconds - left.modifiedAtMilliseconds ||
  right.runId.localeCompare(left.runId)

/** Selects exact report paths from already discovered artifacts. */
export const select = (
  artifacts: ReadonlyArray<ReportArtifact>,
  scope: Scope,
): Effect.Effect<ReadonlyArray<ReportArtifact>, ReportSelectionInvalid> => {
  const sorted = [...artifacts].sort(newestFirst)
  if (sorted.length === 0) return Effect.fail(new ReportSelectionInvalid({ reason: "no-reports" }))
  return Match.value(scope).pipe(
    Match.when({ kind: "latest" }, () => Effect.succeed(sorted.slice(0, 1))),
    Match.when({ kind: "all" }, () => Effect.succeed(sorted)),
    Match.when({ kind: "campaign" }, ({ campaignId }) => {
      const reports = sorted.filter(
        ({ runId }) => String(runId) === String(campaignId) || runId.startsWith(`${campaignId}-`),
      )
      return reports.length === 0
        ? Effect.fail(new ReportSelectionInvalid({ reason: "no-campaign-reports" }))
        : Effect.succeed(reports)
    }),
    Match.exhaustive,
  )
}

/** Discovers regular, non-symlink Vitest Evals reports and applies the requested scope. */
export const discover = (scope: Scope) =>
  Effect.gen(function* () {
    const config = yield* Config.DxEvalConfig
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    if (!(yield* fs.exists(config.artifactsRoot))) {
      return yield* new ReportSelectionInvalid({ reason: "no-reports" })
    }
    const entries = yield* fs.readDirectory(config.artifactsRoot)
    const artifacts = yield* Effect.forEach(entries, (entry) =>
      Effect.gen(function* () {
        const runId = Schema.decodeUnknownOption(Domain.RunId)(entry)
        if (Option.isNone(runId)) return Option.none<ReportArtifact>()
        const reportPath = path.join(config.artifactsRoot, entry, "outputFile.json")
        if (!(yield* fs.exists(reportPath))) return Option.none<ReportArtifact>()
        const link = yield* Effect.option(fs.readLink(reportPath))
        if (Option.isSome(link)) return Option.none<ReportArtifact>()
        const info = yield* fs.stat(reportPath)
        if (info.type !== "File") return Option.none<ReportArtifact>()
        return Option.some({
          runId: runId.value,
          reportPath,
          modifiedAtMilliseconds: Option.match(info.mtime, {
            onNone: () => 0,
            onSome: (date) => date.getTime(),
          }),
        })
      }),
    )
    return yield* select(artifacts.flatMap(Option.toArray), scope)
  })
