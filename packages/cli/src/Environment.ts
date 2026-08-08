import * as Context from "effect/Context"
import * as Layer from "effect/Layer"

export interface Service {
  readonly cwd: string
  readonly nodeExecutable: string
}

export class Environment extends Context.Service<Environment, Service>()(
  "better-native/Environment",
) {}

export const layer = (service: Service) => Layer.succeed(Environment, Environment.of(service))
