import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Command from "effect/unstable/cli/Command"
import { command } from "./Command.ts"
import * as ExpoRepository from "./ExpoRepository.ts"
import * as BuildPipeline from "./build/BuildPipeline.ts"
import * as BuildCommand from "./build/BuildCommand.ts"
import * as ExpoToolchain from "./build/ExpoToolchain.ts"
import * as EvidenceStore from "./evidence/EvidenceStore.ts"
import * as ExternalRunnerSupervisor from "./supervision/ExternalRunnerSupervisor.ts"
import * as DiscoveryPass from "./evidence/DiscoveryPass.ts"
import * as NativeSupervisor from "./supervision/NativeSupervisor.ts"
import * as PlatformDrivers from "./supervision/PlatformDrivers.ts"
import * as ProcessSupervisor from "./supervision/ProcessSupervisor.ts"
import * as WebSupervisor from "./supervision/WebSupervisor.ts"

const root = process.cwd()
const BaseLayer = BunServices.layer
const ProcessLayer = ProcessSupervisor.layer.pipe(Layer.provideMerge(BaseLayer))
const EvidenceLayer = EvidenceStore.layer(root).pipe(Layer.provideMerge(BaseLayer))
const BuildCommandLayer = BuildCommand.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(ProcessLayer, EvidenceLayer)),
)
const ExpoToolchainLayer = ExpoToolchain.layer(root).pipe(Layer.provide(BuildCommandLayer))
const DiscoveryLayer = DiscoveryPass.layer.pipe(Layer.provideMerge(EvidenceLayer))
const BuildLayer = BuildPipeline.layer(root).pipe(
  Layer.provide(Layer.mergeAll(BaseLayer, EvidenceLayer, BuildCommandLayer, ExpoToolchainLayer)),
)
const WebLayer = WebSupervisor.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(WebSupervisor.browserLayer, ProcessLayer, EvidenceLayer, DiscoveryLayer),
  ),
)
const DriverLayer = PlatformDrivers.layer.pipe(Layer.provideMerge(ProcessLayer))
const ExternalLayer = ExternalRunnerSupervisor.layer(root).pipe(
  Layer.provideMerge(Layer.mergeAll(ProcessLayer, EvidenceLayer, BaseLayer)),
)
const NativeLayer = NativeSupervisor.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(DriverLayer, EvidenceLayer)),
)
const RepositoryLayer = ExpoRepository.layer(root).pipe(Layer.provideMerge(BaseLayer))
const MainLayer = Layer.mergeAll(
  BaseLayer,
  ProcessLayer,
  EvidenceLayer,
  DiscoveryLayer,
  BuildLayer,
  BuildCommandLayer,
  ExpoToolchainLayer,
  WebLayer,
  DriverLayer,
  NativeLayer,
  ExternalLayer,
  RepositoryLayer,
)

Command.run(command, { version: "0.0.0" }).pipe(Effect.provide(MainLayer), BunRuntime.runMain)
