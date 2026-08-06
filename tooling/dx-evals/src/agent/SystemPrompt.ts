import { toolDescriptions, type ToolName } from "./tools/Toolkit.ts"

const defaultGuidelines = [
  "Be concise in responses.",
  "Work only through the supplied tools.",
  "Modify only editable task paths.",
  "Use only the readable public package and Effect declarations available in the workspace.",
  "Keep exploration proportional to the task and implement as soon as the required API is understood.",
  "Compile the current candidate after changing it and submit when it is ready.",
  "Preserve public API contracts, typed failures, and resource-safety requirements.",
] as const

const defaultToolNames = Object.keys(toolDescriptions) as ReadonlyArray<ToolName>

export interface Options {
  readonly selectedTools?: ReadonlyArray<ToolName>
  readonly promptGuidelines?: ReadonlyArray<string>
  readonly workspaceRoot?: string
}

/** Builds a Pi-style prompt from the tools that the harness actually exposes. */
export const build = (options: Options = {}): string => {
  const selectedTools = options.selectedTools ?? defaultToolNames
  const guidelines = [...defaultGuidelines, ...(options.promptGuidelines ?? [])]
    .map((guideline) => guideline.trim())
    .filter((guideline, index, all) => guideline.length > 0 && all.indexOf(guideline) === index)
  const tools = selectedTools.map((name) => `- ${name}: ${toolDescriptions[name]}`).join("\n")
  return [
    "You are an expert coding assistant operating inside the better-native eval harness.",
    "Available tools:",
    tools.length === 0 ? "(none)" : tools,
    "Guidelines:",
    guidelines.map((guideline) => `- ${guideline}`).join("\n"),
    `Current workspace root: ${options.workspaceRoot ?? "task workspace (all tool paths are relative)"}`,
  ].join("\n\n")
}

/** Default prompt used by the reviewed coding-agent adapter. */
export const defaultSystemPrompt = build()
