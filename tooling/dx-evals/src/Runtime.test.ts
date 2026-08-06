import { assert, describe, it } from "@effect/vitest"
import * as Config from "./Config.ts"
import { disposeDxEvalRuntime, dxEvalRuntime } from "./Runtime.ts"

describe("DX eval managed runtime", () => {
  it("builds the application Layer once and disposes once", async () => {
    const first = await dxEvalRuntime.runPromise(Config.DxEvalConfig)
    const second = await dxEvalRuntime.runPromise(Config.DxEvalConfig)

    assert.strictEqual(first, second)

    const firstDisposal = disposeDxEvalRuntime()
    const secondDisposal = disposeDxEvalRuntime()
    assert.strictEqual(firstDisposal, secondDisposal)
    await firstDisposal

    let rejected = false
    try {
      await dxEvalRuntime.runPromise(Config.DxEvalConfig)
    } catch {
      rejected = true
    }
    assert.isTrue(rejected)
  })
})
