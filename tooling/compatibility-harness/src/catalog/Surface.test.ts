import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Path from "effect/Path"
import { provideLayer } from "../TestLayers.ts"
import { exportsOf, moduleCandidates } from "./Surface.ts"

describe("Surface", () => {
  it.effect(
    "prefers declaration modules while following exports from a declaration entrypoint",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path
        const candidates = moduleCandidates(path, "build/index.d.ts", "./Notifications.types")
        assert.isBelow(
          candidates.indexOf("build/Notifications.types.d.ts"),
          candidates.indexOf("build/Notifications.types.js"),
        )

        const jsSpecifier = moduleCandidates(path, "build/index.d.ts", "./TokenEmitter.js")
        assert.isBelow(
          jsSpecifier.indexOf("build/TokenEmitter.d.ts"),
          jsSpecifier.indexOf("build/TokenEmitter.js"),
        )
      }).pipe(provideLayer(NodeServices.layer)),
  )

  it.effect("classifies named re-exports from their defining declarations", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const surface = exportsOf(
        path,
        ["build/index.js", "build/index.d.ts"],
        new Map([
          [
            "build/index.js",
            "export { operation, Mode } from './api.js'; export * from './models.js'",
          ],
          [
            "build/index.d.ts",
            "export { operation, Mode } from './api.js'; export * from './models.js'",
          ],
          ["build/api.js", "export function operation() {} export const Mode = {}"],
          [
            "build/api.d.ts",
            "export declare function operation(): void; export declare enum Mode { Ready = 'ready' }",
          ],
          ["build/models.js", "export {}"],
          ["build/models.d.ts", "export type Model = { readonly id: string }"],
        ]),
      )
      assert.strictEqual(surface.get("operation")?.kind, "value")
      assert.strictEqual(surface.get("Mode")?.kind, "value-and-type")
      assert.strictEqual(surface.get("Model")?.kind, "type")
    }).pipe(provideLayer(NodeServices.layer)),
  )
})
