import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Command from "effect/unstable/cli/Command"
import { BuildId } from "../Domain.ts"
import { ExpoRepository } from "../ExpoRepository.ts"
import { BuildPipeline } from "../build/BuildPipeline.ts"
import { ExpoToolchain } from "../build/ExpoToolchain.ts"
import {
  allowNativeRebuildFlag,
  buildIdFlag,
  buildMode,
  buildPlatform,
  candidateRevision,
  capabilitySourceFlag,
  configuredCandidateRevision,
  timeoutMillisFlag,
} from "./Shared.ts"

/**
 * Prepares and validates the pinned Expo toolchain.
 */
export const prepareExpo = Command.make(
  "prepare-expo",
  { timeoutMillis: timeoutMillisFlag },
  Effect.fn("Command.prepareExpo")(function* ({ timeoutMillis }) {
    const repository = yield* ExpoRepository
    const toolchain = yield* ExpoToolchain
    const revision = repository.upstreams.expo.revision
    const prepared = yield* toolchain.ensure({
      id: BuildId.make(`expo-${revision.slice(0, 12)}-v3`),
      mode: "upstream",
      platform: "web",
      expoRevision: revision,
      candidateRevision: null,
      timeoutMillis,
    })
    yield* Console.log(
      JSON.stringify({ revision, root: prepared.root, artifacts: prepared.artifacts.length }),
    )
  }),
).pipe(
  Command.withDescription(
    "Prepare and validate the pinned Expo toolchain before compatibility builds",
  ),
)

/**
 * Builds one upstream or candidate compatibility app.
 */
export const supervisedBuild = Command.make(
  "supervise-build",
  {
    mode: buildMode,
    platform: buildPlatform,
    buildId: buildIdFlag,
    timeoutMillis: timeoutMillisFlag,
    allowNativeRebuild: allowNativeRebuildFlag,
    source: capabilitySourceFlag,
  },
  Effect.fn("Command.superviseBuild")(function* ({
    mode,
    platform,
    buildId,
    timeoutMillis,
    allowNativeRebuild,
    source,
  }) {
    const repository = yield* ExpoRepository
    const builds = yield* BuildPipeline
    const revision = yield* candidateRevision(mode)
    const output = yield* builds.build({
      id: buildId,
      mode,
      platform,
      expoRevision: repository.upstreams.expo.revision,
      candidateRevision: revision,
      timeoutMillis,
      allowNativeRebuild,
      ...(Option.isSome(source) ? { capabilitySource: source.value } : {}),
    })
    yield* Console.log(JSON.stringify(output.record, null, 2))
  }),
).pipe(Command.withDescription("Create an isolated production web or Release native build"))

/**
 * Builds upstream and candidate apps from one shared materialization.
 *
 * @remarks
 * Sharing the materialization keeps the pair comparable while allowing distinct
 * JavaScript resolution modes.
 */
export const supervisedBuildPair = Command.make(
  "supervise-build-pair",
  {
    platform: buildPlatform,
    buildId: buildIdFlag,
    timeoutMillis: timeoutMillisFlag,
    allowNativeRebuild: allowNativeRebuildFlag,
    source: capabilitySourceFlag,
  },
  Effect.fn("Command.superviseBuildPair")(function* ({
    platform,
    buildId,
    timeoutMillis,
    allowNativeRebuild,
    source,
  }) {
    const repository = yield* ExpoRepository
    const builds = yield* BuildPipeline
    const revision = yield* configuredCandidateRevision
    const capabilitySource = Option.getOrUndefined(source)
    const output = yield* builds.buildPair({
      materializationId: BuildId.make(`${buildId}-expo`),
      upstream: {
        id: BuildId.make(`${buildId}-upstream`),
        mode: "upstream",
        platform,
        expoRevision: repository.upstreams.expo.revision,
        candidateRevision: null,
        timeoutMillis,
        allowNativeRebuild,
        ...(capabilitySource === undefined ? {} : { capabilitySource }),
      },
      candidate: {
        id: BuildId.make(`${buildId}-candidate`),
        mode: "candidate",
        platform,
        expoRevision: repository.upstreams.expo.revision,
        candidateRevision: revision,
        timeoutMillis,
        allowNativeRebuild,
        ...(capabilitySource === undefined ? {} : { capabilitySource }),
      },
    })
    yield* Console.log(
      JSON.stringify(
        { upstream: output.upstream.record, candidate: output.candidate.record },
        null,
        2,
      ),
    )
  }),
).pipe(
  Command.withDescription(
    "Create paired isolated builds from one verified pinned Expo materialization",
  ),
)
