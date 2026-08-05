import * as Context from "effect/Context"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { BuildRecord, ProcessObservation } from "../Domain.ts"
import { EvidenceStore } from "../evidence/EvidenceStore.ts"
import {
  ProcessSupervisor,
  type ProcessResult,
  type ProcessSpec,
} from "../supervision/ProcessSupervisor.ts"
import { BuildPipelineError, type BuildRequest } from "./BuildModel.ts"

/** Build command result together with phase-specific observations. */
export interface BuildCommandResult {
  readonly result: ProcessResult
  readonly artifact: BuildRecord["artifacts"][number]
  readonly phase: BuildRecord["performance"]["phases"][number]
}

interface Service {
  readonly persistObservations: (
    request: BuildRequest,
    name: string,
    observations: ReadonlyArray<ProcessObservation>,
  ) => Effect.Effect<BuildRecord["artifacts"][number], BuildPipelineError>
  readonly run: (
    request: BuildRequest,
    phase: BuildPipelineError["phase"],
    name: string,
    spec: ProcessSpec,
  ) => Effect.Effect<BuildCommandResult, BuildPipelineError>
}

/** Effect context tag for build commands recorded as evidence. */
export class BuildCommand extends Context.Service<BuildCommand, Service>()(
  "@better-native/compatibility-harness/BuildCommand",
) {}

/**
 * Builds the command service from process supervision and evidence storage.
 *
 * @returns A layer providing {@link BuildCommand}.
 */
export const layer: Layer.Layer<BuildCommand, never, ProcessSupervisor | EvidenceStore> =
  Layer.effect(
    BuildCommand,
    Effect.gen(function* () {
      const processes = yield* ProcessSupervisor
      const evidence = yield* EvidenceStore

      const persistObservations: Service["persistObservations"] = (request, name, observations) =>
        evidence
          .writeBytes(
            "builds",
            request.id,
            name,
            "application/x-ndjson",
            new TextEncoder().encode(
              observations.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
            ),
          )
          .pipe(
            Effect.mapError(
              (cause) => new BuildPipelineError({ phase: "evidence", request, cause }),
            ),
          )

      const run: Service["run"] = (request, phase, name, spec) =>
        Effect.gen(function* () {
          const startedAtMillis = yield* Clock.currentTimeMillis
          const result = yield* processes
            .run(spec)
            .pipe(
              Effect.catch((cause) =>
                persistObservations(request, name, cause.observations).pipe(
                  Effect.andThen(Effect.fail(new BuildPipelineError({ phase, request, cause }))),
                ),
              ),
            )
          const artifact = yield* persistObservations(request, name, result.observations)
          if (result.exitCode !== 0) {
            const detail = result.observations
              .slice(-30)
              .map(({ text }) => text)
              .join("\n")
            return yield* new BuildPipelineError({
              phase,
              request,
              cause: `command exited ${result.exitCode}\n${detail}`,
            })
          }
          const finishedAtMillis = yield* Clock.currentTimeMillis
          return {
            result,
            artifact,
            phase: {
              name,
              startedAtMillis,
              finishedAtMillis,
              durationMillis: finishedAtMillis - startedAtMillis,
            },
          }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof BuildPipelineError
              ? cause
              : new BuildPipelineError({ phase, request, cause }),
          ),
        )

      return BuildCommand.of({ persistObservations, run })
    }),
  )
