import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as CompileCheck from "../CompileCheck.ts"
import { assertDiagnosticsSanitized, liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as Network from "../../tasks/Network.ts"

it.effect("reports an invalid Network Schema API with sanitized diagnostics", () =>
  Effect.gen(function* () {
    const network = yield* Network.load
    const result = yield* CompileCheck.checkSubmission(network, {
      entries: [
        {
          kind: "file",
          path: network.definition.entrypoint,
          content:
            'import * as Schema from "effect/Schema"\n' +
            "export const NetworkSnapshot = Schema.Union(\n" +
            '  Schema.Struct({ status: Schema.Literal("available") }),\n' +
            '  Schema.Struct({ status: Schema.Literal("failure") }),\n' +
            ")\n" +
            "export const readNetwork = NetworkSnapshot\n",
        },
      ],
    })

    assert.strictEqual(result.status, "failed")
    assert.isTrue(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 2345 && diagnostic.message.includes("readonly Constraint[]"),
      ),
    )
    assertDiagnosticsSanitized(result.diagnostics)
  }).pipe(provideLayer(liveLayer)),
)
