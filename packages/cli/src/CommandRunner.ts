import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { CliFailure } from "./Model.ts"

export interface RunRequest {
  readonly executable: string
  readonly arguments: ReadonlyArray<string>
  readonly cwd: string
}

export interface Service {
  readonly inherited: (request: RunRequest) => Effect.Effect<void, CliFailure>
}

export class CommandRunner extends Context.Service<CommandRunner, Service>()(
  "better-native/CommandRunner",
) {}

export const layer: Layer.Layer<CommandRunner, never, ChildProcessSpawner.ChildProcessSpawner> =
  Layer.effect(
    CommandRunner,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const inherited = Effect.fn("CommandRunner.inherited")(function* (request: RunRequest) {
        const exitCode = yield* spawner
          .exitCode(
            ChildProcess.make(request.executable, request.arguments, {
              cwd: request.cwd,
              stdin: "inherit",
              stdout: "inherit",
              stderr: "inherit",
              env: { EXPO_NO_TELEMETRY: "1" },
              extendEnv: true,
              shell: false,
            }),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new CliFailure({
                  responsibility: "expo",
                  message: `Could not execute ${request.executable}.`,
                  cause,
                }),
            ),
          )
        if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
          return yield* new CliFailure({
            responsibility: "expo",
            message: `The project-local Expo CLI exited with code ${exitCode}.`,
          })
        }
      })
      return CommandRunner.of({ inherited })
    }),
  )
