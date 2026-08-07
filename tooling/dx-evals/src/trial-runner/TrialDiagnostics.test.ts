import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestConsole from "effect/testing/TestConsole"
import { runTrial } from "../TrialRunner.ts"
import { mainLayer, syntheticInput } from "../TrialRunnerTestSupport.ts"
import { provideLayer } from "../TestLayers.ts"

it.effect("logs safe trial lifecycle diagnostics without untrusted instructions", () =>
  Effect.gen(function* () {
    const untrustedInstruction = "SENSITIVE-UNTRUSTED-INSTRUCTION-MUST-NOT-BE-LOGGED"
    const runId = `test-${process.pid}-synthetic-diagnostics-1`
    yield* runTrial({
      ...syntheticInput,
      instruction: untrustedInstruction,
      runId,
      adapterId: "reference",
    })

    const renderedLogs = JSON.stringify(yield* TestConsole.logLines)
    assert.include(renderedLogs, "Trial started")
    assert.include(renderedLogs, "Trial verification completed")
    assert.include(renderedLogs, "Trial evidence persisted")
    assert.include(renderedLogs, "Trial completed")
    assert.include(renderedLogs, runId)
    assert.notInclude(renderedLogs, untrustedInstruction)
  }).pipe(provideLayer(mainLayer)),
)
