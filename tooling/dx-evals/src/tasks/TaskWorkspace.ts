/** Shared task registry and workspace operations retained as the harness-facing facade. */
export { loadTask, type Task } from "./TaskRegistry.ts"
export type {
  AgentWorkspaceSeed,
  CandidateWorkspace,
  FixtureFile,
  TaskBase,
  TaskDefinition,
  TaskExport,
} from "./TaskModel.ts"
export {
  exportTask,
  makeAgentWorkspaceSeed,
  materializeCandidate,
  TaskBundleInvalid,
} from "./Workspace.ts"
