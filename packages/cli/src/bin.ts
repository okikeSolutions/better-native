#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as CliConfig from "effect/unstable/cli/CliConfig"
import * as GlobalFlag from "effect/unstable/cli/GlobalFlag"
import * as Application from "./Application.ts"
import * as CommandRunner from "./CommandRunner.ts"
import { run } from "./Cli.ts"
import * as Environment from "./Environment.ts"
import * as Project from "./Project.ts"

const NodeLive = NodeServices.layer
const EnvironmentLive = Environment.layer({
  cwd: process.cwd(),
  nodeExecutable: process.execPath,
})
const InfrastructureLive = Layer.merge(NodeLive, EnvironmentLive)
const ProjectLive = Project.layer.pipe(Layer.provideMerge(InfrastructureLive))
const CommandRunnerLive = CommandRunner.layer.pipe(Layer.provideMerge(InfrastructureLive))
const ServicesLive = Layer.mergeAll(InfrastructureLive, ProjectLive, CommandRunnerLive)
const InstallerLive = Application.installerLayer.pipe(Layer.provideMerge(ServicesLive))
const DoctorLive = Application.doctorLayer.pipe(Layer.provideMerge(ServicesLive))
const CliConfigLive = CliConfig.layer({ builtIns: [GlobalFlag.Help, GlobalFlag.Version] })
const MainLive = Layer.mergeAll(ServicesLive, InstallerLive, DoctorLive, CliConfigLive)

const runtime = ManagedRuntime.make(MainLive)

const main = Effect.flatMap(runtime.contextEffect, (context) =>
  Effect.provideContext(run(process.argv.slice(2)), context),
).pipe(Effect.ensuring(runtime.disposeEffect))

NodeRuntime.runMain(main, { disableErrorReporting: true })
