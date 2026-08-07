import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { collectExports, targets } from "./ExpoCompatEntrypoint.ts"

describe("ExpoCompatEntrypoint", () => {
  it.effect("collects named, type-only, wildcard, enum, and cyclic exports", () => {
    const sources = new Map([
      [
        "src/index.ts",
        [
          "export const direct = 1",
          'export { named, type NamedType as AliasedType } from "./named"',
          'export * from "./types"',
          'export * from "./cycle-a"',
        ].join("\n"),
      ],
      ["src/named.ts", "export const named = 1\nexport interface NamedType {}"],
      [
        "src/types.ts",
        "export enum RuntimeEnum { Value = 'value' }\nexport type Model = { readonly id: string }",
      ],
      ["src/cycle-a.ts", "export class CycleValue {}\nexport * from './cycle-b'"],
      ["src/cycle-b.ts", "export interface CycleType {}\nexport * from './cycle-a'"],
    ])
    const resolve = (source: string, specifier: string) => {
      const directory = source.slice(0, source.lastIndexOf("/"))
      return `${directory}/${specifier.slice(2)}.ts`
    }

    return Effect.gen(function* () {
      const result = yield* collectExports(
        "src/index.ts",
        (file) => Effect.succeed(sources.get(file) ?? ""),
        resolve,
      )

      assert.deepEqual(result.values, ["CycleValue", "RuntimeEnum", "direct", "named"])
      assert.deepEqual(result.types, ["AliasedType", "CycleType", "Model", "RuntimeEnum"])
    })
  })

  it("derives only conventional better-native Expo entrypoint targets", () => {
    assert.deepEqual(
      targets([
        { source: "expo-network", target: "@better-native/network/expo" },
        { source: "expo-battery", target: "@better-native/battery" },
      ]),
      [{ source: "expo-network", path: "packages/network/src/Expo.ts" }],
    )
  })
})
