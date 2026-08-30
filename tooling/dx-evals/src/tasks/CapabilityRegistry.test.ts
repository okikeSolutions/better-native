import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { registeredTaskIds } from "./TaskRegistry.ts"

interface CapabilityLedger {
  readonly capabilities: ReadonlyArray<{
    readonly id: string
    readonly requirements: { readonly dxEval: boolean }
  }>
}

const ledger = JSON.parse(
  readFileSync(new URL("../../../../compatibility/capabilities.json", import.meta.url), "utf8"),
) as CapabilityLedger

describe("DX capability registry", () => {
  it("registers every capability whose migration requires a DX eval", () => {
    const expected = ledger.capabilities
      .filter(({ requirements }) => requirements.dxEval)
      .map(({ id }) => id)
      .toSorted()
    const actual = registeredTaskIds.filter((id) => id !== "synthetic-effect")

    expect(actual).toEqual(expected)
  })
})
