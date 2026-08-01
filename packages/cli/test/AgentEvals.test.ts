import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { DiagnosticCode } from "@effect-expo/core/Diagnostic"
import { checkPolicySource } from "../src/PolicyCheck.ts"

interface EvalCase {
  readonly id: string
  readonly kind: "static-policy-fixture" | "agent-task"
  readonly fixture: string
  readonly expectedDiagnosticCodes?: ReadonlyArray<DiagnosticCode>
  readonly expectedTests?: ReadonlyArray<string>
}

interface EvalManifest {
  readonly schemaVersion: number
  readonly cases: ReadonlyArray<EvalCase>
}

const manifest = JSON.parse(readFileSync("evals/agent/evals.json", "utf8")) as EvalManifest

describe("agent evaluation fixture contract", () => {
  it("uses a versioned manifest", () => {
    expect(manifest.schemaVersion).toBe(1)
  })

  it("distinguishes static policy fixtures from unexecuted agent tasks", () => {
    expect(manifest.cases.filter((item) => item.kind === "static-policy-fixture")).toHaveLength(4)
    expect(manifest.cases.filter((item) => item.kind === "agent-task")).toHaveLength(2)
  })

  for (const evaluation of manifest.cases.filter((item) => item.kind === "static-policy-fixture")) {
    it(`${evaluation.id} produces its expected architectural diagnostic`, () => {
      const source = readFileSync(`evals/agent/${evaluation.fixture}`, "utf8")
      const diagnostics = checkPolicySource(`apps/eval/src/${evaluation.id}.ts`, source)

      expect(diagnostics.map((item) => item.code)).toEqual(evaluation.expectedDiagnosticCodes)
    })
  }

  for (const evaluation of manifest.cases.filter((item) => item.kind === "agent-task")) {
    it(`${evaluation.id} has a versioned task prompt and an explicit oracle`, () => {
      const task = readFileSync(`evals/agent/${evaluation.fixture}`, "utf8")
      expect(task).toMatch(/^# Task\n/m)
      expect(task.trim().length).toBeGreaterThan(20)
      expect(
        (evaluation.expectedDiagnosticCodes?.length ?? 0) > 0 ||
          (evaluation.expectedTests?.length ?? 0) > 0
      ).toBe(true)
    })
  }
})
