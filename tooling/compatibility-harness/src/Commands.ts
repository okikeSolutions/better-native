import * as Command from "effect/unstable/cli/Command"
import {
  generate,
  validate,
  matrix,
  doctor,
  coverage,
  securityAudit,
  updateSurfaceLock,
} from "./commands/CoreCommands.ts"
import { prepareExpo, supervisedBuild, supervisedBuildPair } from "./commands/BuildCommands.ts"
import { supervisedWeb, supervisedWebPair, probeWeb } from "./commands/WebCommands.ts"
import { supervisedNative, supervisedNativePair } from "./commands/NativeCommands.ts"
import { supervisedExternal, supervisedRunnerPlans, compareRuns } from "./commands/RunCommands.ts"

/** Root CLI command exposing every compatibility harness workflow. */
export const command = Command.make("compatibility-harness").pipe(
  Command.withDescription("Expo compatibility harness for better-native"),
  Command.withSubcommands([
    generate,
    validate,
    matrix,
    doctor,
    coverage,
    securityAudit,
    updateSurfaceLock,
    prepareExpo,
    supervisedBuild,
    supervisedBuildPair,
    supervisedWeb,
    supervisedWebPair,
    probeWeb,
    supervisedNative,
    supervisedNativePair,
    supervisedExternal,
    supervisedRunnerPlans,
    compareRuns,
  ]),
)
