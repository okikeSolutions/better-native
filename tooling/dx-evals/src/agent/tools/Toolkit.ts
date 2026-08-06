import * as Tool from "effect/unstable/ai/Tool"
import * as Toolkit from "effect/unstable/ai/Toolkit"
import * as Schema from "effect/Schema"
import * as CompileCheck from "../CompileCheck.ts"
import * as VirtualWorkspace from "./VirtualWorkspace.ts"

/** Ordered descriptions shared by the Effect AI toolkit and the agent system prompt. */
export const toolDescriptions = {
  ls: "List immediate entries in a readable workspace directory.",
  find: "Find readable workspace files using a glob such as '**/*.ts'.",
  read: "Read a bounded window from one workspace file. Large files are limited to 2,000 lines or 50 KiB; use offset to continue.",
  grep: "Search readable workspace files by regex or literal text. Returns bounded matching lines with file paths and line numbers.",
  edit: "Make precise edits to one editable file. Use { path, oldText, newText } for one replacement or { path, edits: [...] } for a batch. Every oldText must match exactly once and edits must not overlap.",
  write: "Replace one editable task-relative file with complete UTF-8 content.",
  check_submission: "Compile the current editable files against the installed public package.",
  submit: "Finish the trial and submit all changed editable files.",
} as const

export type ToolName = keyof typeof toolDescriptions

const ToolReply = Schema.Struct({
  ok: Schema.Boolean,
  content: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})

const Ls = Tool.make("ls", {
  description: toolDescriptions.ls,
  parameters: VirtualWorkspace.ListRequest,
  success: VirtualWorkspace.PathResult,
})

const Find = Tool.make("find", {
  description: toolDescriptions.find,
  parameters: VirtualWorkspace.FindRequest,
  success: VirtualWorkspace.PathResult,
})

const Read = Tool.make("read", {
  description: toolDescriptions.read,
  parameters: VirtualWorkspace.ReadRequest,
  success: VirtualWorkspace.ReadResult,
})

const Grep = Tool.make("grep", {
  description: toolDescriptions.grep,
  parameters: VirtualWorkspace.SearchRequest,
  success: VirtualWorkspace.SearchResult,
})

const Edit = Tool.make("edit", {
  description: toolDescriptions.edit,
  parameters: VirtualWorkspace.EditRequest,
  success: ToolReply,
})

const Write = Tool.make("write", {
  description: toolDescriptions.write,
  parameters: Schema.Struct({ path: Schema.String, content: Schema.String }),
  success: ToolReply,
})

const CheckSubmission = Tool.make("check_submission", {
  description: toolDescriptions.check_submission,
  parameters: Schema.Struct({ confirm: Schema.Literal(true) }),
  success: CompileCheck.PublicCompileResult,
})

const Submit = Tool.make("submit", {
  description: toolDescriptions.submit,
  parameters: Schema.Struct({ confirm: Schema.Literal(true) }),
  success: Schema.Struct({ submitted: Schema.Boolean }),
})

/** Effect AI tools exposed by the repository-owned coding harness. */
export const CodingToolkit = Toolkit.make(
  Ls,
  Find,
  Read,
  Grep,
  Edit,
  Write,
  CheckSubmission,
  Submit,
)
