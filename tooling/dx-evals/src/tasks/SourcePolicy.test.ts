import { assert, describe, it } from "@effect/vitest"
import * as SourcePolicy from "./SourcePolicy.ts"

describe("candidate public-package source policy", () => {
  it("accepts static public-package and Effect imports", () => {
    assert.isTrue(
      SourcePolicy.checkPublicConsumer(
        'import * as Effect from "effect/Effect"\nimport { Network } from "@better-native/network"',
        "@better-native/network",
      ).passed,
    )
  })

  for (const [name, source] of [
    [
      "computed import",
      'import { Network } from "@better-native/network"\nimport("expo-" + "network")',
    ],
    ["direct double", 'import { Network } from "@better-native/network"\nimport "expo-network"'],
    [
      "process escape",
      'import { Network } from "@better-native/network"\nprocess.stdout.write("x")',
    ],
    ["deep package import", 'import "@better-native/network/build/internal.js"'],
  ] as const) {
    it(`rejects ${name}`, () => {
      assert.isFalse(SourcePolicy.checkPublicConsumer(source, "@better-native/network").passed)
    })
  }
})
