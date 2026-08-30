import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import { ArtifactLifecycle, ArtifactLifecycleError } from "../artifacts/ArtifactLifecycle.ts"

/** Reports or applies local artifact retention and the shared 8 GiB cache budget. */
export const artifactsPrune = Command.make(
  "artifacts-prune",
  { dryRun: Flag.boolean("dry-run").pipe(Flag.withDefault(false)) },
  Effect.fn("Command.artifactsPrune")(function* ({ dryRun }) {
    const lifecycle = yield* ArtifactLifecycle
    const report = yield* lifecycle.prune({ dryRun })
    yield* Console.log(JSON.stringify(report, null, 2))
  }),
).pipe(Command.withDescription("Prune stale unlocked artifacts and enforce the local cache budget"))

/** Explicit emergency removal of all repository-owned artifacts. */
export const artifactsClean = Command.make(
  "artifacts-clean",
  { all: Flag.boolean("all").pipe(Flag.withDefault(false)) },
  Effect.fn("Command.artifactsClean")(function* ({ all }) {
    if (!all) {
      return yield* new ArtifactLifecycleError({
        operation: "clean all artifacts",
        cause: "refusing cleanup without the explicit --all flag",
      })
    }
    const lifecycle = yield* ArtifactLifecycle
    yield* Console.log(JSON.stringify(yield* lifecycle.cleanAll, null, 2))
  }),
).pipe(Command.withDescription("Emergency removal of all inactive repository artifacts"))
