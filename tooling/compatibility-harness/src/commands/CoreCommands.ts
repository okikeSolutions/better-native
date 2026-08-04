import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import * as Compatibility from "../Compatibility.ts"
import * as Coverage from "../Coverage.ts"
import * as AuditPolicy from "../security/AuditPolicy.ts"

export const generate = Command.make("generate", {}, Compatibility.generate).pipe(
  Command.withDescription("Generate the compatibility catalog artifact"),
)

export const validate = Command.make("validate", {}, Compatibility.validate).pipe(
  Command.withDescription("Validate pinned sources and compatibility configuration"),
)

export const matrix = Command.make("matrix", {}, Compatibility.matrix).pipe(
  Command.withDescription("Print the current Expo compatibility denominator"),
)

export const doctor = Command.make("doctor", {}, Compatibility.doctor).pipe(
  Command.withDescription("Validate the installed Expo packages"),
)

export const coverageJson = Flag.boolean("json").pipe(
  Flag.withDescription("Print machine-readable coverage JSON"),
)

export const coverage = Command.make("coverage", { json: coverageJson }, Coverage.report).pipe(
  Command.withDescription("Print Better Native API coverage by Expo package"),
)

export const securityAudit = Command.make("security-audit", {}, AuditPolicy.run).pipe(
  Command.withDescription("Audit dependencies against exact reviewed Expo exception paths"),
)

export const updateSurfaceLock = Command.make(
  "update-surface-lock",
  {},
  Compatibility.updateSurfaceLock,
).pipe(Command.withDescription("Review and update the pinned Expo surface lock"))
