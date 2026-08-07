import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as CompileCheck from "./CompileCheck.ts"
import * as Config from "../Config.ts"
import * as Isolation from "../security/Isolation.ts"
import * as Battery from "../tasks/Battery.ts"
import * as Network from "../tasks/Network.ts"
import * as PackageArtifact from "../tasks/PackageArtifact.ts"
import * as Synthetic from "../tasks/Synthetic.ts"
import { provideLayer } from "../TestLayers.ts"

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url))
const platformLayer = Layer.merge(Config.layer(repositoryRoot), NodeServices.layer)
const packageLayer = PackageArtifact.layer.pipe(Layer.provideMerge(platformLayer))

describe("public submission compiler", () => {
  it.effect("materializes no grader or solution files for the compiler", () => {
    const fakeIsolation = Isolation.layerFromService({
      observe: (request) =>
        Effect.sync(() => {
          assert.strictEqual(request.runner, "check-types.ts")
          assert.isFalse(existsSync(`${request.workspace}/grader`))
          assert.isFalse(existsSync(`${request.workspace}/reference.patch`))
          assert.isFalse(existsSync(`${request.workspace}/broken.patch`))
          assert.notInclude(
            readFileSync(`${request.workspace}/src/ObserveBattery.ts`, "utf8"),
            "reference",
          )
          return {
            authenticationNonce: "compile-test",
            exitCode: 0,
            stdout:
              'BETTER_NATIVE_OBSERVATION:compile-test:{"schemaVersion":1,"kind":"compile","status":"passed","diagnostics":[],"truncated":false}\n',
            stderr: "",
            truncated: false,
          }
        }),
    })
    const layer = fakeIsolation.pipe(Layer.provideMerge(packageLayer))
    return Effect.gen(function* () {
      const task = yield* Battery.load
      const result = yield* CompileCheck.checkSubmission(task, { entries: [] })
      assert.strictEqual(result.status, "passed")
    }).pipe(provideLayer(layer))
  })

  it.effect("passes the agent-visible Network compile contract into isolation", () => {
    const fakeIsolation = Isolation.layerFromService({
      observe: (request) =>
        Effect.sync(() => {
          assert.deepStrictEqual(request.publicCompileContract, {
            kind: "effect-no-requirements",
            exportName: "readNetwork",
          })
          return {
            authenticationNonce: "network-contract-test",
            exitCode: 0,
            stdout:
              'BETTER_NATIVE_OBSERVATION:network-contract-test:{"schemaVersion":1,"kind":"compile","status":"passed","diagnostics":[],"truncated":false}\n',
            stderr: "",
            truncated: false,
          }
        }),
    })
    const layer = fakeIsolation.pipe(Layer.provideMerge(packageLayer))
    return Effect.gen(function* () {
      const task = yield* Network.load
      const result = yield* CompileCheck.checkSubmission(task, {
        entries: [],
      })
      assert.strictEqual(result.status, "passed")
    }).pipe(provideLayer(layer))
  })

  it.effect("returns a stable timeout without leaking infrastructure details", () => {
    const fakeIsolation = Isolation.layerFromService({
      observe: () => Effect.fail(new Isolation.IsolationFailure({ reason: "timeout" })),
    })
    const layer = fakeIsolation.pipe(Layer.provideMerge(packageLayer))
    return Effect.gen(function* () {
      const task = yield* Synthetic.load
      const result = yield* CompileCheck.checkSubmission(task, {
        entries: [],
      })
      assert.deepStrictEqual(result, CompileCheck.timedOut)
    }).pipe(provideLayer(layer))
  })
})
