import { assert, describe, it } from "@effect/vitest"
import * as SystemPrompt from "./SystemPrompt.ts"

describe("coding-agent system prompt", () => {
  it("lists only selected tools and keeps workflow guidance proportional", () => {
    const prompt = SystemPrompt.build({
      selectedTools: ["read", "check_submission", "submit"],
      workspaceRoot: "virtual-task",
    })

    assert.include(prompt, "expert coding assistant")
    assert.include(prompt, "- read: Read a bounded window")
    assert.include(prompt, "- check_submission: Compile the current editable files")
    assert.include(prompt, "- submit: Finish the trial")
    assert.notInclude(prompt, "- grep:")
    assert.include(prompt, "Keep exploration proportional")
    assert.notInclude(prompt, "declaration graph before editing")
    assert.include(prompt, "Current workspace root: virtual-task")
  })

  it("deduplicates appended guidelines", () => {
    const guideline = "Modify only editable task paths."
    const prompt = SystemPrompt.build({
      promptGuidelines: [guideline, guideline, ""],
    })
    assert.strictEqual(prompt.split(guideline).length - 1, 1)
  })
})
