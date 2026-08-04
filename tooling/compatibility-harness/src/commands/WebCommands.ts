import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import { BuildId, RunId } from "../Domain.ts"
import { ExpoRepository } from "../ExpoRepository.ts"
import { HarnessError } from "../HarnessError.ts"
import * as AppRegistry from "../registry/AppRegistry.ts"
import * as Suites from "../suites/Suites.ts"
import { BuildPipeline } from "../build/BuildPipeline.ts"
import { WebSupervisor } from "../supervision/WebSupervisor.ts"
import {
  buildIdFlag,
  buildMode,
  candidateRevision,
  configuredCandidateRevision,
  requireSuccessfulRun,
  timeoutMillisFlag,
} from "./Shared.ts"

const webPort = Flag.integer("port").pipe(Flag.withDefault(8091))
const webSource = Flag.string("source").pipe(Flag.optional)

const selectWebUnits = (
  units: ReadonlyArray<ReturnType<typeof AppRegistry.appExecutionUnits>[number]>,
  source: Option.Option<string>,
) =>
  Option.match(source, {
    onNone: () => units,
    onSome: (sourceId) => units.filter((unit) => unit.sourceId === sourceId),
  })

export const supervisedWeb = Command.make(
  "supervise-web",
  {
    mode: buildMode,
    buildId: buildIdFlag,
    source: webSource,
    timeoutMillis: timeoutMillisFlag,
    port: webPort,
  },
  Effect.fn("Command.superviseWeb")(function* ({ mode, buildId, source, timeoutMillis, port }) {
    const repository = yield* ExpoRepository
    const builds = yield* BuildPipeline
    const web = yield* WebSupervisor
    const corpus = yield* Suites.discover()
    const revision = yield* candidateRevision(mode)
    const metadata = yield* AppRegistry.loadMetadata()
    const units = selectWebUnits(AppRegistry.appExecutionUnits(metadata, "web"), source)
    if (units.length === 0) {
      return yield* new HarnessError({
        operation: "select web source",
        cause: `source ${Option.getOrElse(source, () => "<all>")} is not web-app executable`,
      })
    }
    const build = yield* builds.build({
      id: buildId,
      mode,
      platform: "web",
      expoRevision: repository.upstreams.expo.revision,
      candidateRevision: revision,
      timeoutMillis,
    })
    const records = yield* web.runAll(
      units.map((unit) => ({
        id: RunId.make(`${buildId}-run-${unit.id}`),
        build,
        unit,
        port,
        timeoutMillis,
        corpus,
      })),
    )
    yield* Effect.forEach(records, requireSuccessfulRun, { discard: true })
    return yield* Console.log(
      JSON.stringify(records.map(({ finalInfrastructure }) => finalInfrastructure)),
    )
  }),
).pipe(Command.withDescription("Build and execute a production web compatibility run"))

export const supervisedWebPair = Command.make(
  "supervise-web-pair",
  { buildId: buildIdFlag, source: webSource, timeoutMillis: timeoutMillisFlag, port: webPort },
  Effect.fn("Command.superviseWebPair")(function* ({ buildId, source, timeoutMillis, port }) {
    const repository = yield* ExpoRepository
    const builds = yield* BuildPipeline
    const web = yield* WebSupervisor
    const corpus = yield* Suites.discover()
    const revision = yield* configuredCandidateRevision
    const metadata = yield* AppRegistry.loadMetadata()
    const units = selectWebUnits(AppRegistry.appExecutionUnits(metadata, "web"), source)
    if (units.length === 0) {
      return yield* new HarnessError({
        operation: "select web source",
        cause: `source ${Option.getOrElse(source, () => "<all>")} is not web-app executable`,
      })
    }
    const pair = yield* builds.buildPair({
      materializationId: BuildId.make(`${buildId}-expo`),
      upstream: {
        id: BuildId.make(`${buildId}-upstream`),
        mode: "upstream",
        platform: "web",
        expoRevision: repository.upstreams.expo.revision,
        candidateRevision: null,
        timeoutMillis,
      },
      candidate: {
        id: BuildId.make(`${buildId}-candidate`),
        mode: "candidate",
        platform: "web",
        expoRevision: repository.upstreams.expo.revision,
        candidateRevision: revision,
        timeoutMillis,
      },
    })
    const upstream = yield* web.runAll(
      units.map((unit) => ({
        id: RunId.make(`${buildId}-upstream-run-${unit.id}`),
        build: pair.upstream,
        unit,
        port,
        timeoutMillis,
        corpus,
      })),
    )
    yield* Effect.forEach(upstream, requireSuccessfulRun, { discard: true })
    const candidate = yield* web.runAll(
      units.map((unit) => ({
        id: RunId.make(`${buildId}-candidate-run-${unit.id}`),
        build: pair.candidate,
        unit,
        port,
        timeoutMillis,
        corpus,
      })),
    )
    yield* Effect.forEach(candidate, requireSuccessfulRun, { discard: true })
    return yield* Console.log(
      JSON.stringify({
        upstream: upstream.map(({ finalInfrastructure }) => finalInfrastructure),
        candidate: candidate.map(({ finalInfrastructure }) => finalInfrastructure),
      }),
    )
  }),
).pipe(
  Command.withDescription(
    "Build and execute paired production web runs from one pinned Expo materialization",
  ),
)

const probeSpecifier = Flag.string("specifier")
export const probeWeb = Command.make(
  "probe-web",
  {
    mode: buildMode,
    buildId: buildIdFlag,
    timeoutMillis: timeoutMillisFlag,
    port: webPort,
    specifier: probeSpecifier,
  },
  Effect.fn("Command.probeWeb")(function* ({ mode, buildId, timeoutMillis, port, specifier }) {
    const repository = yield* ExpoRepository
    const builds = yield* BuildPipeline
    const web = yield* WebSupervisor
    const corpus = yield* Suites.discover()
    const revision = yield* candidateRevision(mode)
    const build = yield* builds.build({
      id: buildId,
      mode,
      platform: "web",
      expoRevision: repository.upstreams.expo.revision,
      candidateRevision: revision,
      timeoutMillis,
      probeSpecifier: specifier,
    })
    const discovery = yield* web.probe({
      id: RunId.make(`${buildId}-probe`),
      build,
      specifier,
      port,
      timeoutMillis,
      corpus,
    })
    yield* Console.log(JSON.stringify(discovery.exports[0] ?? null, null, 2))
  }),
).pipe(Command.withDescription("Build and execute one isolated opaque Expo export probe"))
