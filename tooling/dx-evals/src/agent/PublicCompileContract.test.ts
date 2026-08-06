import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import * as Protocol from "../../runner/Protocol.ts"
import * as TaskModel from "../tasks/TaskModel.ts"

describe("public compile contract protocol", () => {
  it("accepts a reviewed export name and rejects source-injection syntax", () => {
    assert.isTrue(
      Schema.is(Protocol.PublicCompileContract)({
        kind: "effect-no-requirements",
        exportName: "readNetwork",
      }),
    )
    assert.isTrue(
      Schema.is(TaskModel.PublicCompileContract)({
        kind: "effect-no-requirements",
        exportName: "readNetwork",
      }),
    )
    assert.isFalse(
      Schema.is(Protocol.PublicCompileContract)({
        kind: "effect-no-requirements",
        exportName: "candidate; process.exit(1)",
      }),
    )
    assert.isFalse(
      Schema.is(TaskModel.PublicCompileContract)({
        kind: "effect-no-requirements",
        exportName: "candidate; process.exit(1)",
      }),
    )
  })
})
