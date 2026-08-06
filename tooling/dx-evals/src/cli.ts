import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Command from "effect/unstable/cli/Command"
import { command } from "./Commands.ts"
import { disposeDxEvalRuntime, dxEvalRuntime } from "./Runtime.ts"

try {
  const exitCode = await dxEvalRuntime.runPromise(
    Command.run(command, { version: "0.0.0" }).pipe(
      Effect.as(0),
      Effect.catchTag("PaidExecutionNotConfirmed", () =>
        Console.error(
          "Paid execution was not started. Review `evals plan`, then pass --confirm-paid.",
        ).pipe(Effect.as(1)),
      ),
      Effect.catchTag("PaidProbeNotConfirmed", () =>
        Console.error(
          "Paid provider probe was not started. Review its fixed bounds, then pass --confirm-paid.",
        ).pipe(Effect.as(1)),
      ),
      Effect.catchTag("ProviderCompatibilityRejected", (error) =>
        Console.error(`Provider profile quarantined by compatibility probe: ${error.reason}.`).pipe(
          Effect.as(1),
        ),
      ),
      Effect.catchTag("OpenRouterCredentialMissing", () =>
        Console.error(
          "Paid execution was not started. Set OPENROUTER_API_KEY in the environment or repository .env.local file.",
        ).pipe(Effect.as(1)),
      ),
      Effect.catchTag("EvalProcessFailure", (error) =>
        Console.error(
          `${error.operation} failed${error.exitCode === undefined ? "" : ` with exit code ${error.exitCode}`}.`,
        ).pipe(Effect.as(1)),
      ),
      Effect.catchTag("CampaignSummaryInvalid", (error) =>
        Console.error(`Campaign summary failed: ${error.reason}.`).pipe(Effect.as(1)),
      ),
      Effect.catchTag("ReportSelectionInvalid", (error) =>
        Console.error(`Report selection failed: ${error.reason}.`).pipe(Effect.as(1)),
      ),
    ),
  )
  process.exitCode = exitCode
} finally {
  await disposeDxEvalRuntime()
}
