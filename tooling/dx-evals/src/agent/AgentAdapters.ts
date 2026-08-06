import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import * as Config from "../Config.ts"
import * as Domain from "../Domain.ts"
import * as Submission from "../security/Submission.ts"
import * as TaskWorkspace from "../tasks/TaskWorkspace.ts"
import * as OpenRouterAgent from "./OpenRouterAgent.ts"

/** Declared failure channel shared by reviewed adapter implementations. */
export type AgentAdapterError =
  | PlatformError.PlatformError
  | Submission.SubmissionInvalid
  | TaskWorkspace.TaskBundleInvalid
  | Effect.Error<ReturnType<typeof OpenRouterAgent.run>>

/** Trial-visible result returned by an agent adapter. */
export interface AdapterResult {
  readonly disposition: "reference" | "noop" | "broken" | "agent"
  readonly transcript: ReadonlyArray<Domain.TranscriptEvent>
  readonly submission: Submission.Submission
  readonly usage: Domain.UsageSummary
  readonly agentProfile?: import("./AgentProfiles.ts").AgentProfile
  readonly exitReason?: import("./AgentLoop.ts").AgentExitReason
}

/** Adapter capable of executing one declared trial configuration. */
export interface AgentAdapter {
  readonly id: Domain.AdapterId
  readonly run: (
    input: Domain.TrialInput,
  ) => Effect.Effect<
    AdapterResult,
    AgentAdapterError,
    | Config.DxEvalConfig
    | FileSystem.FileSystem
    | Path.Path
    | OpenRouterAgent.OpenRouterAccess
    | import("./AgentProfiles.ts").AgentProfiles
    | import("../campaign/CampaignBudget.ts").CampaignBudget
    | import("../security/Isolation.ts").Isolation
    | import("../tasks/PackageArtifact.ts").PackageArtifacts
    | import("@effect/ai-openrouter/OpenRouterClient").OpenRouterClient
  >
}

/** Failure raised when a trial requests an adapter outside the reviewed registry. */
export class AdapterNotFound extends Data.TaggedError("AdapterNotFound")<{
  readonly adapterId: Domain.AdapterId
}> {}

/** Agent-adapter registry service used by the trial runner. */
export interface Service {
  readonly run: (
    adapterId: Domain.AdapterId,
    input: Domain.TrialInput,
  ) => Effect.Effect<
    AdapterResult,
    AgentAdapterError | AdapterNotFound,
    | Config.DxEvalConfig
    | FileSystem.FileSystem
    | Path.Path
    | OpenRouterAgent.OpenRouterAccess
    | import("./AgentProfiles.ts").AgentProfiles
    | import("../campaign/CampaignBudget.ts").CampaignBudget
    | import("../security/Isolation.ts").Isolation
    | import("../tasks/PackageArtifact.ts").PackageArtifacts
    | import("@effect/ai-openrouter/OpenRouterClient").OpenRouterClient
  >
}

/** Effect context tag for the reviewed agent-adapter registry. */
export class AgentAdapters extends Context.Service<AgentAdapters, Service>()(
  "@better-native/dx-evals/AgentAdapters",
) {}

const message = (role: "user" | "assistant", content: string): Domain.TranscriptEvent => ({
  type: "message",
  role,
  content,
})

/** Known-valid adapter used to prove that the foundation flow can pass. */
export const reference: AgentAdapter = {
  id: Domain.AdapterId.make("reference"),
  run: (input) =>
    Effect.gen(function* () {
      const task = yield* TaskWorkspace.loadTask(input.taskId)
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const patch = yield* fs.readFileString(path.join(task.root, "reference.patch"))
      const content = yield* Submission.applySingleFilePatch(
        task.fixtureFiles[0]!.content,
        patch,
        task.definition.entrypoint,
      )
      return {
        disposition: "reference" as const,
        usage: {},
        submission: {
          entries: [{ kind: "file" as const, path: task.definition.entrypoint, content }],
        },
        transcript: [
          message("user", task.instruction),
          message("assistant", "Submitted the repository-owned reference patch."),
        ],
      }
    }),
}

/** Empty-submission adapter used to prove that the foundation flow can fail. */
export const noop: AgentAdapter = {
  id: Domain.AdapterId.make("noop"),
  run: (input) =>
    Effect.map(TaskWorkspace.loadTask(input.taskId), (task) => ({
      disposition: "noop" as const,
      usage: {},
      submission: { entries: [] },
      transcript: [
        message("user", task.instruction),
        message("assistant", "The no-op adapter intentionally produced no submission."),
      ],
    })),
}

/** Known-invalid adapter used to prove that superficial output cannot satisfy the Effect gate. */
export const broken: AgentAdapter = {
  id: Domain.AdapterId.make("broken"),
  run: (input) =>
    Effect.gen(function* () {
      const task = yield* TaskWorkspace.loadTask(input.taskId)
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const patch = yield* fs.readFileString(path.join(task.root, "broken.patch"))
      const content = yield* Submission.applySingleFilePatch(
        task.fixtureFiles[0]!.content,
        patch,
        task.definition.entrypoint,
      )
      return {
        disposition: "broken" as const,
        usage: {},
        submission: {
          entries: [{ kind: "file" as const, path: task.definition.entrypoint, content }],
        },
        transcript: [
          message("user", task.instruction),
          message("assistant", "Submitted the repository-owned deliberately broken patch."),
        ],
      }
    }),
}

/** Real Effect AI coding adapter parameterized by a reviewed agent profile. */
export const openrouterCodingAgent: AgentAdapter = {
  id: Domain.AdapterId.make("openrouter-coding-agent"),
  run: (input) =>
    OpenRouterAgent.run(input).pipe(
      Effect.map((result) => ({
        disposition: "agent" as const,
        submission: result.submission,
        transcript: result.transcript,
        usage: result.usage,
        agentProfile: result.profile,
        exitReason: result.exitReason,
      })),
    ),
}

const adapters = new Map(
  [reference, noop, broken, openrouterCodingAgent].map((adapter) => [adapter.id, adapter]),
)

/** Layer containing only the reviewed adapters available to this harness revision. */
export const layer = Layer.succeed(
  AgentAdapters,
  AgentAdapters.of({
    run: (adapterId, input) => {
      const adapter = adapters.get(adapterId)
      return adapter === undefined
        ? Effect.fail(new AdapterNotFound({ adapterId }))
        : adapter.run(input)
    },
  }),
)
