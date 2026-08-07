import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as CompileCheck from "./CompileCheck.ts"
import * as Config from "../Config.ts"
import * as Isolation from "../security/Isolation.ts"
import * as Submission from "../security/Submission.ts"
import * as Battery from "../tasks/Battery.ts"
import * as KeepAwake from "../tasks/KeepAwake.ts"
import * as Network from "../tasks/Network.ts"
import * as PackageArtifact from "../tasks/PackageArtifact.ts"
import * as Synthetic from "../tasks/Synthetic.ts"
import { provideLayer } from "../TestLayers.ts"

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url))
const platformLayer = Layer.merge(Config.layer(repositoryRoot), NodeServices.layer)
const packageLayer = PackageArtifact.layer.pipe(Layer.provideMerge(platformLayer))
const liveLayer = Isolation.layer.pipe(Layer.provideMerge(packageLayer))

const referenceSubmission = (task: Battery.Task | Network.Task | KeepAwake.Task) =>
  Effect.gen(function* () {
    const patch = readFileSync(`${task.root}/reference.patch`, "utf8")
    const content = yield* Submission.applySingleFilePatch(
      task.fixtureFiles[0]!.content,
      patch,
      task.definition.entrypoint,
    )
    return {
      entries: [{ kind: "file", path: task.definition.entrypoint, content }],
    } satisfies Submission.Submission
  })

describe("public submission compiler", () => {
  it.effect("compiles the Network, Battery, and Keep Awake reference solutions", () =>
    Effect.gen(function* () {
      const network = yield* Network.load
      const battery = yield* Battery.load
      const keepAwake = yield* KeepAwake.load
      const networkResult = yield* CompileCheck.checkSubmission(
        network,
        yield* referenceSubmission(network),
      )
      const batteryResult = yield* CompileCheck.checkSubmission(
        battery,
        yield* referenceSubmission(battery),
      )
      const keepAwakeResult = yield* CompileCheck.checkSubmission(
        keepAwake,
        yield* referenceSubmission(keepAwake),
      )

      assert.deepStrictEqual(networkResult, {
        status: "passed",
        diagnostics: [],
        truncated: false,
      })
      assert.deepStrictEqual(batteryResult, {
        status: "passed",
        diagnostics: [],
        truncated: false,
      })
      assert.deepStrictEqual(keepAwakeResult, {
        status: "passed",
        diagnostics: [],
        truncated: false,
      })
    }).pipe(provideLayer(liveLayer)),
  )

  it.effect("reports invalid Effect Stream and Schema APIs with sanitized diagnostics", () =>
    Effect.gen(function* () {
      const battery = yield* Battery.load
      const batteryResult = yield* CompileCheck.checkSubmission(battery, {
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
      const network = yield* Network.load
      const networkResult = yield* CompileCheck.checkSubmission(network, {
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

      assert.strictEqual(batteryResult.status, "failed")
      assert.isTrue(batteryResult.diagnostics.some((diagnostic) => diagnostic.code === 2339))
      assert.strictEqual(networkResult.status, "failed")
      assert.isTrue(
        networkResult.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === 2345 && diagnostic.message.includes("readonly Constraint[]"),
        ),
      )
      for (const diagnostic of [...batteryResult.diagnostics, ...networkResult.diagnostics]) {
        assert.notInclude(diagnostic.message, "/workspace")
        assert.notInclude(diagnostic.message, "/runner")
        assert.notInclude(diagnostic.message, repositoryRoot)
      }
    }).pipe(provideLayer(liveLayer)),
  )

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
