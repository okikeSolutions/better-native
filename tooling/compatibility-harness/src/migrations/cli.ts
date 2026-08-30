import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import { report } from "./CapabilityMigrations.ts"

const strict = process.argv.includes("--strict")

/* oxlint-disable effecttsgo/strict-effect-provide -- migration status application entry point */
report(strict).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
/* oxlint-enable effecttsgo/strict-effect-provide */
