import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import ts from "typescript"
import {
  CoverageMappings,
  makeCoverageCompilerHost,
  type TypeScriptExports,
  validateCoverageMappings,
  validateCoverageSourceFiles,
  validateCoverageTarget,
  validateCoverageTypeTarget,
  validateNoStaleCoverageMappings,
  validateNoStaleTypeCoverageMappings,
  validateSharedCompilerConfig,
} from "./Coverage.ts"

const revision = "1".repeat(40)
const exportsOf = (entries: ReadonlyArray<readonly [string, string]>): TypeScriptExports => ({
  valueNames: new Set(entries.map(([name]) => name)),
  typeNames: new Set(entries.map(([name]) => name)),
  types: new Map(entries),
  callable: new Set(entries.flatMap(([name, type]) => (type.includes("=>") ? [name] : []))),
})
const noExports = exportsOf([])

describe("coverage mapping validation", () => {
  it("shares compiler state only across compatible package configurations", () => {
    const config = (packageName: string, configFilePath: string, strict = true) => ({
      packageName,
      entryPoint: `/repo/packages/${packageName}/src/index.ts`,
      expoCompat: `/repo/packages/${packageName}/src/Expo.ts`,
      options: { strict, configFilePath },
      projectReferences: undefined,
    })

    assert.strictEqual(
      validateSharedCompilerConfig([
        config("battery", "/repo/packages/battery/tsconfig.json"),
        config("network", "/repo/packages/network/tsconfig.json"),
      ]).packageName,
      "battery",
    )
    assert.throws(
      () =>
        validateSharedCompilerConfig([
          config("battery", "/repo/packages/battery/tsconfig.json"),
          config("network", "/repo/packages/network/tsconfig.json", false),
        ]),
      /network does not share coverage compiler settings with battery/,
    )
  })

  it("disables JSDoc parsing in the coverage compiler host", () => {
    const host = makeCoverageCompilerHost({ strict: true })

    assert.strictEqual(host.jsDocParsingMode, ts.JSDocParsingMode.ParseNone)
    assert.doesNotThrow(() =>
      validateCoverageSourceFiles(["/repo/packages/example/src/index.ts", "/types/effect.d.ts"]),
    )
    assert.throws(
      () => validateCoverageSourceFiles(["/repo/packages/example/src/runtime.js"]),
      /cannot disable JSDoc parsing for JavaScript input.*runtime\.js/,
    )
  })

  it.effect("rejects a mapping pinned to a different Expo revision", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateCoverageMappings(
          { schemaVersion: 3, expoRevision: revision, mappings: [], typeMappings: [] },
          "2".repeat(40),
        ),
      )

      assert.match(String(error.cause), /does not match pinned revision/)
    }),
  )

  it.effect("requires complete orthogonal deprecation metadata", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateCoverageMappings(
          {
            schemaVersion: 3,
            expoRevision: revision,
            typeMappings: [],
            mappings: [
              {
                package: "expo-example",
                expoExport: "oldApi",
                status: "effect-api",
                target: "@better-native/example#oldApi",
                deprecated: true,
              },
            ],
          },
          revision,
        ),
      )

      assert.match(String(error.cause), /invalid deprecation metadata/)
    }),
  )

  it.effect("rejects duplicate mappings", () =>
    Effect.gen(function* () {
      const mapping = {
        package: "expo-example",
        expoExport: "getValueAsync",
        status: "effect-api" as const,
        target: "@better-native/example#getValueAsync",
      }
      const error = yield* Effect.flip(
        validateCoverageMappings(
          {
            schemaVersion: 3,
            expoRevision: revision,
            mappings: [mapping, mapping],
            typeMappings: [],
          },
          revision,
        ),
      )

      assert.match(String(error.cause), /duplicate mapping expo-example#getValueAsync/)
    }),
  )

  it.effect("rejects stale mappings", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateNoStaleCoverageMappings(
          [
            {
              package: "expo-example",
              expoExport: "removedApi",
              status: "effect-api",
              target: "@better-native/example#removedApi",
            },
          ],
          new Set(["expo-example#getValueAsync"]),
        ),
      )

      assert.match(String(error.cause), /unknown mapping expo-example#removedApi/)
    }),
  )

  it.effect("rejects duplicate and stale public-type mappings", () =>
    Effect.gen(function* () {
      const mapping = {
        package: "expo-example",
        expoType: "ValueOptions",
        status: "effect-type" as const,
        target: "@better-native/example#ValueOptions",
      }
      const duplicate = yield* Effect.flip(
        validateCoverageMappings(
          {
            schemaVersion: 3,
            expoRevision: revision,
            mappings: [],
            typeMappings: [mapping, mapping],
          },
          revision,
        ),
      )
      assert.match(String(duplicate.cause), /duplicate type mapping expo-example#ValueOptions/)

      const stale = yield* Effect.flip(
        validateNoStaleTypeCoverageMappings([mapping], new Set(["expo-example#CurrentOptions"])),
      )
      assert.match(String(stale.cause), /unknown type mapping expo-example#ValueOptions/)
    }),
  )

  it.effect("rejects renamed and value-only public-type targets", () =>
    Effect.gen(function* () {
      const renamed = yield* Effect.flip(
        validateCoverageTypeTarget(
          "expo-example",
          "ValueOptions",
          {
            package: "expo-example",
            expoType: "ValueOptions",
            status: "effect-type",
            target: "@better-native/example#Options",
          },
          { root: exportsOf([["Options", "Options"]]), expoCompat: noExports },
        ),
      )
      assert.match(String(renamed.cause), /missing or invalid type target.*#Options/)

      const valueOnly: TypeScriptExports = {
        valueNames: new Set(["ValueOptions"]),
        typeNames: new Set(),
        types: new Map([["ValueOptions", "string"]]),
        callable: new Set(),
      }
      const incorrectlyTyped = yield* Effect.flip(
        validateCoverageTypeTarget(
          "expo-example",
          "ValueOptions",
          {
            package: "expo-example",
            expoType: "ValueOptions",
            status: "effect-type",
            target: "@better-native/example#ValueOptions",
          },
          { root: valueOnly, expoCompat: noExports },
        ),
      )
      assert.match(String(incorrectlyTyped.cause), /missing or invalid type target/)
    }),
  )

  it.effect("rejects renamed targets even when the renamed export exists", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateCoverageTarget(
          "expo-example",
          "getValueAsync",
          {
            package: "expo-example",
            expoExport: "getValueAsync",
            status: "effect-api",
            target: "@better-native/example#readValue",
          },
          {
            root: exportsOf([["readValue", '() => import("effect/Effect").Effect<number>']]),
            expoCompat: noExports,
          },
        ),
      )

      assert.match(String(error.cause), /missing or invalid target.*#readValue/)
    }),
  )

  it.effect("rejects missing target exports", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateCoverageTarget(
          "expo-example",
          "getValueAsync",
          {
            package: "expo-example",
            expoExport: "getValueAsync",
            status: "effect-api",
            target: "@better-native/example#getValueAsync",
          },
          { root: noExports, expoCompat: noExports },
        ),
      )

      assert.match(String(error.cause), /missing or invalid target.*#getValueAsync/)
    }),
  )

  it.effect("rejects mappings missing their required target declaration", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Schema.decodeUnknownEffect(CoverageMappings)({
          schemaVersion: 3,
          expoRevision: revision,
          typeMappings: [],
          mappings: [
            {
              package: "expo-example",
              expoExport: "getValueAsync",
              status: "effect-api",
            },
          ],
        }),
      )

      assert.match(String(error), /target/)
    }),
  )

  it.effect("rejects incorrectly typed Effect Stream mappings", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateCoverageTarget(
          "expo-example",
          "addValueListener",
          {
            package: "expo-example",
            expoExport: "addValueListener",
            status: "effect-stream",
            target: "@better-native/example#addValueListener",
          },
          {
            root: exportsOf([["addValueListener", '() => import("effect/Effect").Effect<void>']]),
            expoCompat: noExports,
          },
        ),
      )

      assert.match(String(error.cause), /not an Effect Stream/)
    }),
  )

  it.effect("rejects Promise functions mislabeled as Effect APIs", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateCoverageTarget(
          "expo-example",
          "getValueAsync",
          {
            package: "expo-example",
            expoExport: "getValueAsync",
            status: "effect-api",
            target: "@better-native/example#getValueAsync",
          },
          {
            root: exportsOf([["getValueAsync", "() => Promise<number>"]]),
            expoCompat: noExports,
          },
        ),
      )

      assert.match(String(error.cause), /not an Effect value API/)
    }),
  )

  it.effect("rejects incorrectly typed atom mappings", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateCoverageTarget(
          "expo-example",
          "useValue",
          {
            package: "expo-example",
            expoExport: "useValue",
            status: "expo-compat",
            target: "@better-native/example/expo#useValue",
            atomTarget: "@better-native/example#valueAtom",
          },
          {
            root: exportsOf([["valueAtom", 'import("effect/Effect").Effect<number>']]),
            expoCompat: exportsOf([["useValue", "() => number"]]),
          },
        ),
      )

      assert.match(String(error.cause), /missing or invalid atom target/)
    }),
  )

  it.effect("rejects atom targets outside hook mappings", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateCoverageMappings(
          {
            schemaVersion: 3,
            expoRevision: revision,
            typeMappings: [],
            mappings: [
              {
                package: "expo-example",
                expoExport: "getValueAsync",
                status: "effect-api",
                target: "@better-native/example#getValueAsync",
                atomTarget: "@better-native/example#valueAtom",
              },
            ],
          },
          revision,
        ),
      )

      assert.match(String(error.cause), /only valid for an Expo-compatible hook mapping/)
    }),
  )
})
