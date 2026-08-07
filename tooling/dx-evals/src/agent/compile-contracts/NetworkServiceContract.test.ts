import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as CompileCheck from "../CompileCheck.ts"
import { liveLayer } from "../ReferenceCompileContract.ts"
import { provideLayer } from "../../TestLayers.ts"
import * as Network from "../../tasks/Network.ts"

it.effect("rejects a Network Effect that leaves its public service contract unprovided", () =>
  Effect.gen(function* () {
    const network = yield* Network.load
    const result = yield* CompileCheck.checkSubmission(network, {
      entries: [
        {
          kind: "file",
          path: network.definition.entrypoint,
          content: [
            'import * as Network from "@better-native/network"',
            'import * as Effect from "effect/Effect"',
            'import * as Schema from "effect/Schema"',
            "export const NetworkSnapshot = Schema.Unknown",
            "export const readNetwork: Effect.Effect<unknown, never, Network.NetworkService> = Network.getNetworkStateAsync",
          ].join("\n"),
        },
      ],
    })

    assert.strictEqual(result.status, "failed")
    assert.isTrue(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.file === "public-contract.ts" && diagnostic.message.includes("never"),
      ),
    )
  }).pipe(provideLayer(liveLayer)),
)
