import { runBuild } from "@expo/metro/metro"
import { getDefaultConfig } from "@expo/metro-config"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Path from "node:path"
// The pinned Expo CLI resolver-chain implementation is a behavioral oracle without declarations.
// @ts-expect-error -- intentionally testing the exact installed Expo CLI implementation.
import ExpoMetroResolvers from "@expo/cli/build/src/start/server/metro/withMetroResolvers"
import * as Crypto from "effect/Crypto"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as Layer from "effect/Layer"
import { withBetterNative, type ResolutionEvent } from "../../../src/BetterNativeMetroConfig.ts"

const mode = process.argv[2]
if (mode !== "upstream" && mode !== "candidate") {
  throw new Error("expected upstream or candidate mode")
}

const fixtureRoot = import.meta.dirname
const buildId = `${mode}-production-build`
const runId = `${mode}-production-run`
const { withMetroResolvers } = ExpoMetroResolvers

class MetroBuildError extends Data.TaggedError("MetroBuildError")<{
  readonly mode: "upstream" | "candidate"
  readonly cause: unknown
}> {}

const program = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto
  const events: Array<ResolutionEvent> = []
  const metroConfig = getDefaultConfig(fixtureRoot)
  // This fixture proves resolver behavior in isolation. Expo detects the Bun workspace as a
  // monorepo and otherwise watches unrelated workspace package symlinks.
  metroConfig.watchFolders = [fixtureRoot, Path.resolve(fixtureRoot, "../../../../../node_modules")]
  const betterNativeConfig = withBetterNative(metroConfig, {
    buildId,
    runId,
    mode,
    upstreamNodeModulesPath: `${fixtureRoot}/node_modules`,
    replacements: [{ source: "expo-network", target: "effect/Function" }],
    onResolution: (event) => events.push(event),
  })
  const config = withMetroResolvers(betterNativeConfig, [() => null])
  const output = yield* Effect.tryPromise({
    try: () =>
      runBuild(config, {
        entry: `${fixtureRoot}/index.js`,
        platform: "web",
        dev: false,
        minify: true,
        customResolverOptions: { betterNativeMode: mode, buildId, runId },
      }),
    catch: (cause) => new MetroBuildError({ mode, cause }),
  })
  const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(output.code))
  const networkEvent = yield* Effect.fromNullishOr(
    events.find((event) => event.specifier === "expo-network"),
  ).pipe(
    Effect.mapError(() => new Error("expo-network was not observed")),
    Effect.orDie,
  )
  yield* Effect.sync(() =>
    console.log(
      `BETTER_NATIVE_BUILD=${JSON.stringify({
        mode,
        buildId,
        runId,
        hash: Encoding.encodeHex(digest),
        eventCount: events.length,
        unmanagedCount: events.filter((event) => event.decision === "unmanaged").length,
        networkEvent,
      })}`,
    ),
  )
})

Effect.scoped(
  Layer.build(NodeServices.layer).pipe(
    Effect.flatMap((context) => Effect.provide(program, context)),
  ),
).pipe(NodeRuntime.runMain)
