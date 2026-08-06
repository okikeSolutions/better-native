import { fileURLToPath } from "node:url"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as AgentAdapters from "./agent/AgentAdapters.ts"
import * as AgentProfiles from "./agent/AgentProfiles.ts"
import * as OpenRouterAgent from "./agent/OpenRouterAgent.ts"
import * as CampaignBudget from "./campaign/CampaignBudget.ts"
import * as Config from "./Config.ts"
import * as Evidence from "./evidence/Evidence.ts"
import * as Diagnostics from "./observability/Diagnostics.ts"
import * as Isolation from "./security/Isolation.ts"
import * as PackageArtifact from "./tasks/PackageArtifact.ts"

/**
 * Composes the DX eval application services over Effect's Node platform services.
 *
 * @param repositoryRoot - Absolute better-native repository root.
 * @returns The complete process-owned application layer.
 */
export const makeMainLayer = (repositoryRoot: string) =>
  Layer.mergeAll(
    AgentAdapters.layer,
    AgentProfiles.layer,
    CampaignBudget.layer,
    Diagnostics.layer,
    Evidence.layer,
    Isolation.layer,
    OpenRouterAgent.accessLayer,
    OpenRouterAgent.clientLayer,
    PackageArtifact.layer,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Config.layer(repositoryRoot),
        NodeServices.layer,
        NodeHttpClient.layerNodeHttp,
      ),
    ),
  )

/**
 * Creates a managed runtime whose Layer scope is shared across trial invocations.
 *
 * @param repositoryRoot - Absolute better-native repository root.
 * @returns A managed runtime providing the DX eval and Node services.
 */
export const makeDxEvalRuntime = (repositoryRoot: string) =>
  ManagedRuntime.make(makeMainLayer(repositoryRoot))

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url))

/** Process-owned runtime used by the Vitest Evals custom harness. */
export const dxEvalRuntime = makeDxEvalRuntime(repositoryRoot)

let disposal: Promise<void> | undefined

/**
 * Disposes the process-owned runtime exactly once.
 *
 * @returns The shared disposal promise for the runtime Layer scope.
 */
export const disposeDxEvalRuntime = (): Promise<void> => {
  disposal ??= dxEvalRuntime.dispose()
  return disposal
}
