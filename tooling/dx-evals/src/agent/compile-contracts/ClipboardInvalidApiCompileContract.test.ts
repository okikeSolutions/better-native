import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as CompileCheck from "../CompileCheck.ts"
import { assertDiagnosticsSanitized, liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as Clipboard from "../../tasks/Clipboard.ts"

it.effect("reports an invalid Clipboard Stream API with sanitized diagnostics", () =>
  Effect.gen(function* () {
    const clipboard = yield* Clipboard.load
    const result = yield* CompileCheck.checkSubmission(clipboard, {
      entries: [
        {
          kind: "file",
          path: clipboard.definition.entrypoint,
          content:
            'import { Clipboard } from "@better-native/clipboard"\n' +
            'import * as Stream from "effect/Stream"\n' +
            "export const clipboardContentTypes = Clipboard.addClipboardListener.pipe(\n" +
            "  Stream.map((event) => event.contentTypes),\n" +
            "  Stream.provideLayer(Clipboard.live),\n" +
            ")\n",
        },
      ],
    })

    assert.strictEqual(result.status, "failed")
    assert.isTrue(result.diagnostics.some((diagnostic) => diagnostic.code === 2339))
    assertDiagnosticsSanitized(result.diagnostics)
  }).pipe(provideLayer(liveLayer)),
)
