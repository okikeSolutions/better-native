import { type Diagnostic, type DiagnosticCode, makeDiagnostic } from "@effect-expo/core/Diagnostic"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as CliError from "effect/unstable/cli/CliError"
import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import { renderMatrix } from "./Matrix.ts"
import { checkPolicies, explainDiagnostic, renderDiagnostics } from "./PolicyCheck.ts"
import { checkExpoCatalog, generateExpoCatalog } from "./generator/ExpoCatalogGenerator.ts"
import { checkNetwork, generateNetwork } from "./generator/NetworkGenerator.ts"

const asUserError = Effect.mapError((cause: unknown) => new CliError.UserError({ cause }))

const outputFormat = Flag.choice("format", ["human", "json"] as const).pipe(
  Flag.withDescription("Output format: human | json"),
  Flag.withDefault("human")
)

const diagnosticCodes = [
  "EFFECT_EXPO_GENERATED_DRIFT",
  "EFFECT_EXPO_RAW_CAPABILITY_IMPORT",
  "EFFECT_EXPO_INTERNAL_IMPORT",
  "EFFECT_EXPO_UNMANAGED_RUNTIME",
  "EFFECT_EXPO_TESTING_IMPORT"
] as const satisfies ReadonlyArray<DiagnosticCode>

const diagnosticCode = Flag.choice("code", diagnosticCodes).pipe(
  Flag.withDescription("Stable effect-expo diagnostic code")
)

const generate = Command.make("generate", {}, () =>
  Effect.all([generateNetwork, generateExpoCatalog], { discard: true }).pipe(
    asUserError,
    Effect.andThen(Console.log("Generated Network declarations and Expo SDK catalog"))
  )
)

const generatedDrift = (file: string): Diagnostic =>
  makeDiagnostic({
    code: "EFFECT_EXPO_GENERATED_DRIFT",
    message: "Generated artifact differs from its declarative source",
    file,
    line: 1,
    capability: file.includes("network") ? "network" : "catalog",
    help: "Run `bun run generate` and review the generated patch"
  })

const checkNetworkArtifact = checkNetwork.pipe(
  Effect.as([] as Array<Diagnostic>),
  Effect.catchTag("GeneratedArtifactOutOfDate", (error) =>
    Effect.succeed(error.paths.map(generatedDrift))
  )
)

const checkCatalogArtifact = checkExpoCatalog.pipe(
  Effect.as([] as Array<Diagnostic>),
  Effect.catchTag("ExpoCatalogOutOfDate", (error) => Effect.succeed([generatedDrift(error.path)]))
)

const check = Command.make("check", { format: outputFormat }, ({ format }) =>
  Effect.gen(function* () {
    const artifactDiagnostics = yield* Effect.all([checkNetworkArtifact, checkCatalogArtifact])
    const policyDiagnostics = yield* checkPolicies
    const diagnostics = [...artifactDiagnostics.flat(), ...policyDiagnostics]
    yield* Console.log(renderDiagnostics(diagnostics, format))
    if (diagnostics.length > 0) {
      return yield* new CliError.UserError({
        cause: new Error(`${diagnostics.length} effect-expo diagnostic(s)`)
      })
    }
  }).pipe(asUserError)
)

const matrix = Command.make("matrix", { format: outputFormat }, ({ format }) =>
  Console.log(renderMatrix(format))
)

const explain = Command.make("explain", { code: diagnosticCode }, ({ code }) =>
  Console.log(`${code}\n${explainDiagnostic(code)}`)
)

const root = Command.make("effect-expo").pipe(
  Command.withSubcommands([generate, check, matrix, explain])
)

export const run = Command.run(root, { version: "0.0.0" })
