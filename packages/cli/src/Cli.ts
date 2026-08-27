import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Argument from "effect/unstable/cli/Argument"
import * as CliCommand from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import * as Application from "./Application.ts"
import { capabilityNames, releaseVersion } from "./Model.ts"

const packageManagerFlags = {
  npm: Flag.boolean("npm").pipe(
    Flag.withDescription("Use the npm lockfile and installer"),
    Flag.withDefault(false),
  ),
  pnpm: Flag.boolean("pnpm").pipe(
    Flag.withDescription("Use the pnpm lockfile and installer"),
    Flag.withDefault(false),
  ),
  yarn: Flag.boolean("yarn").pipe(
    Flag.withDescription("Use the Yarn lockfile and installer"),
    Flag.withDefault(false),
  ),
  bun: Flag.boolean("bun").pipe(
    Flag.withDescription("Use the Bun lockfile and installer"),
    Flag.withDefault(false),
  ),
}

export const install = CliCommand.make(
  "install",
  {
    capabilities: Argument.choice("capability", capabilityNames).pipe(
      Argument.atLeast(1),
      Argument.withDescription("Capabilities to install"),
    ),
    dryRun: Flag.boolean("dry-run").pipe(
      Flag.withDescription("Print the exact installation plan without changing the project"),
      Flag.withDefault(false),
    ),
    ...packageManagerFlags,
  },
  Effect.fnUntraced(function* (request) {
    const installer = yield* Application.Installer
    yield* installer.install(request)
  }),
).pipe(CliCommand.withDescription("Install Better Native capability packages into an Expo project"))

export const doctor = CliCommand.make("doctor", {}, () =>
  Effect.gen(function* () {
    const service = yield* Application.Doctor
    yield* service.run
  }),
).pipe(CliCommand.withDescription("Validate an Expo project's Better Native installation"))

export const command = CliCommand.make("better-native").pipe(
  CliCommand.withDescription("Install and diagnose Better Native capabilities"),
  CliCommand.withSubcommands([install, doctor]),
)

export const run = (args: ReadonlyArray<string>) =>
  CliCommand.runWith(command, { version: releaseVersion })(args).pipe(
    Effect.catchTag("CliFailure", (failure) =>
      Console.error(`✗ ${failure.message}`).pipe(Effect.andThen(Effect.fail(failure))),
    ),
  )
