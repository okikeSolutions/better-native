import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as CompileCheck from "../CompileCheck.ts"
import { assertDiagnosticsSanitized, liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as Battery from "../../tasks/Battery.ts"

it.effect("reports an invalid Battery Stream API with sanitized diagnostics", () =>
  Effect.gen(function* () {
    const battery = yield* Battery.load
    const result = yield* CompileCheck.checkSubmission(battery, {
      entries: [
        {
          kind: "file",
          path: battery.definition.entrypoint,
          content:
            'import { Battery } from "@better-native/battery"\n' +
            'import * as Stream from "effect/Stream"\n' +
            "export const batteryLevels = Battery.addBatteryLevelListener.pipe(\n" +
            "  Stream.map((event) => event.batteryLevel),\n" +
            "  Stream.provideLayer(Battery.live),\n" +
            ")\n",
        },
      ],
    })

    assert.strictEqual(result.status, "failed")
    assert.isTrue(result.diagnostics.some((diagnostic) => diagnostic.code === 2339))
    assertDiagnosticsSanitized(result.diagnostics)
  }).pipe(provideLayer(liveLayer)),
)
