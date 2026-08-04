import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Command from "effect/unstable/cli/Command"
import { command } from "./Commands.ts"
import * as ExpoRepository from "./ExpoRepository.ts"
import * as HarnessConfig from "./HarnessConfig.ts"
import * as BuildPipeline from "./build/BuildPipeline.ts"
import * as AppBuildImporter from "./build/AppBuildImporter.ts"
import * as BuildProducts from "./build/BuildProducts.ts"
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
const BaseLayer = NodeServices.layer
const ConfigLayer = HarnessConfig.layer(root).pipe(Layer.provide(BaseLayer))
const ProcessLayer = ProcessSupervisor.layer.pipe(Layer.provideMerge(BaseLayer))
const EvidenceLayer = EvidenceStore.layer(root).pipe(Layer.provideMerge(BaseLayer))
const BuildCommandLayer = BuildCommand.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(ProcessLayer, EvidenceLayer)),
)
const ExpoToolchainLayer = ExpoToolchain.layer(root).pipe(
  Layer.provide(Layer.merge(BuildCommandLayer, ConfigLayer)),
)
const BuildProductsLayer = BuildProducts.layer.pipe(Layer.provide(BaseLayer))
const BuildImporterLayer = AppBuildImporter.layer(root).pipe(
  Layer.provide(Layer.mergeAll(BaseLayer, BuildProductsLayer)),
)
const DiscoveryLayer = DiscoveryPass.layer.pipe(Layer.provideMerge(EvidenceLayer))
const BuildLayer = BuildPipeline.layer(root).pipe(
  Layer.provide(
    Layer.mergeAll(BaseLayer, ConfigLayer, EvidenceLayer, BuildCommandLayer, ExpoToolchainLayer),
  ),
)
const WebLayer = WebSupervisor.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(WebSupervisor.browserLayer, ProcessLayer, EvidenceLayer, DiscoveryLayer),
  ),
)
const DriverLayer = PlatformDrivers.layer.pipe(
  Layer.provideMerge(Layer.merge(ProcessLayer, BaseLayer)),
)
const ExternalLayer = ExternalRunnerSupervisor.layer(root).pipe(
  Layer.provideMerge(Layer.mergeAll(ProcessLayer, EvidenceLayer, BaseLayer)),
)
const NativeLayer = NativeSupervisor.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(DriverLayer, EvidenceLayer)),
)
const RepositoryLayer = ExpoRepository.layer(root).pipe(
  Layer.provideMerge(Layer.merge(BaseLayer, ConfigLayer)),
)
const MainLayer = Layer.mergeAll(
  BaseLayer,
  ConfigLayer,
  ProcessLayer,
  EvidenceLayer,
  DiscoveryLayer,
  BuildLayer,
  BuildImporterLayer,
  BuildCommandLayer,
  ExpoToolchainLayer,
  WebLayer,
  DriverLayer,
  NativeLayer,
  ExternalLayer,
  RepositoryLayer,
)

Command.run(command, { version: "0.0.0" }).pipe(Effect.provide(MainLayer), NodeRuntime.runMain)
