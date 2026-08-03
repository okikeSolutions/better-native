import { assert, describe, it } from "@effect/vitest"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { createRequire } from "node:module"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

const projectRoot = `${import.meta.dirname}/fixtures/paired`
const buildProcess = `${projectRoot}/BuildProcess.ts`
const fixtureRequire = createRequire(`${projectRoot}/package.json`)
const nativeManifest = fixtureRequire.resolve("expo-network/package.json")
const nativeRegistration = fixtureRequire.resolve("expo-network/expo-module.config.json")

const NetworkEvent = Schema.Struct({
  runId: Schema.String,
  buildId: Schema.String,
  mode: Schema.Literals(["upstream", "candidate"]),
  specifier: Schema.Literal("expo-network"),
  replacement: Schema.NullOr(Schema.String),
  decision: Schema.Literals(["upstream", "candidate", "self-upstream", "unmanaged"]),
  platform: Schema.NullOr(Schema.String),
  environment: Schema.NullOr(Schema.String),
  conditions: Schema.Array(Schema.String),
  resolvedTarget: Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
})
const BuildResult = Schema.Struct({
  mode: Schema.Literals(["upstream", "candidate"]),
  buildId: Schema.String,
  runId: Schema.String,
  hash: Schema.String,
  eventCount: Schema.Number,
  unmanagedCount: Schema.Number,
  networkEvent: NetworkEvent,
})

const bundle = (mode: "upstream" | "candidate") =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const output = yield* spawner.string(
      ChildProcess.make("node", [buildProcess, mode], { cwd: projectRoot }),
      { includeStderr: true },
    )
    const marker = output.split("\n").find((line) => line.startsWith("BETTER_NATIVE_BUILD="))
    if (marker === undefined) return yield* Effect.die(`build result marker missing:\n${output}`)
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BuildResult))(
      marker.slice("BETTER_NATIVE_BUILD=".length),
    )
  })

describe("Expo Metro integration", () => {
  it.effect(
    "bundles the same real Expo fixture in isolated upstream and candidate processes",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const manifestBefore = yield* fs.readFileString(nativeManifest)
        const registrationBefore = yield* fs.readFileString(nativeRegistration)

        const upstream = yield* bundle("upstream")
        const candidate = yield* bundle("candidate")

        assert.strictEqual(upstream.networkEvent.decision, "upstream")
        assert.strictEqual(upstream.networkEvent.replacement, null)
        assert.match(String(upstream.networkEvent.resolvedTarget), /expo-network/)
        assert.strictEqual(candidate.networkEvent.decision, "candidate")
        assert.strictEqual(candidate.networkEvent.replacement, "effect/Function")
        assert.match(String(candidate.networkEvent.resolvedTarget), /effect.+Function/)
        assert.strictEqual(upstream.networkEvent.platform, "web")
        assert.include(upstream.networkEvent.conditions, "browser")
        assert.isAbove(upstream.eventCount, 0)
        assert.isAbove(candidate.unmanagedCount, 0)
        assert.notStrictEqual(upstream.hash, candidate.hash)

        assert.strictEqual(yield* fs.readFileString(nativeManifest), manifestBefore)
        assert.strictEqual(yield* fs.readFileString(nativeRegistration), registrationBefore)
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000,
  )
})
