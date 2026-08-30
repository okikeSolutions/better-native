import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import * as Compatibility from "../Compatibility.ts"
import * as Coverage from "../Coverage.ts"
import * as AuditPolicy from "../security/AuditPolicy.ts"

/**
 * Regenerates catalog, ownership, corpus, and compatibility-app outputs.
 *
 * @remarks
 * Generated files are derived from pinned Expo inputs and reviewed policy.
 */
export const generate = Command.make("generate", {}, Compatibility.generate).pipe(
  Command.withDescription("Generate the compatibility catalog artifact"),
)

/**
 * Validates pinned revisions, installation state, surface lock, and policy.
 *
 * @returns A successful command only when the compatibility denominator is valid.
 */
export const validate = Command.make("validate", {}, Compatibility.validate).pipe(
  Command.withDescription("Validate pinned sources and compatibility configuration"),
)

/**
 * Prints the current package, surface, ownership, and test denominator.
 */
export const matrix = Command.make("matrix", {}, Compatibility.matrix).pipe(
  Command.withDescription("Print the current Expo compatibility denominator"),
)

/**
 * Prints installed Expo package and wildcard-entrypoint diagnostics.
 */
export const doctor = Command.make("doctor", {}, Compatibility.doctor).pipe(
  Command.withDescription("Validate the installed Expo packages"),
)

/**
 * Selects machine-readable coverage output for the coverage command.
 */
export const coverageJson = Flag.boolean("json").pipe(
  Flag.withDescription("Print machine-readable coverage JSON"),
  Flag.withDefault(false),
)

/**
 * Reports Better Native coverage of the generated Expo export denominator.
 */
export const coverage = Command.make("coverage", { json: coverageJson }, Coverage.report).pipe(
  Command.withDescription("Print Better Native API coverage by Expo package"),
)

/**
 * Audits dependency advisories against reviewed lockfile exceptions.
 */
export const securityAudit = Command.make("security-audit", {}, AuditPolicy.run).pipe(
  Command.withDescription("Audit dependencies against exact reviewed Expo exception paths"),
)

/**
 * Deliberately updates the reviewed compatibility surface lock.
 *
 * @remarks
 * This command is the explicit review boundary for catalog drift.
 */
export const updateSurfaceLock = Command.make(
  "update-surface-lock",
  {},
  Compatibility.updateSurfaceLock,
).pipe(Command.withDescription("Review and update the pinned Expo surface lock"))
