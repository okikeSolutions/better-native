const path = require("node:path")
const { withBetterNative } = require("@better-native/metro")
const generated = require("./src/generated/Replacements.json")
const trackedSpecifiers = new Set(generated.trackedSpecifiers)

const mode = process.env.BETTER_NATIVE_MODE
const buildId = process.env.BETTER_NATIVE_BUILD_ID
const runId = process.env.BETTER_NATIVE_RUN_ID
const upstreamNodeModulesPath = process.env.BETTER_NATIVE_UPSTREAM_NODE_MODULES
if (mode !== "upstream" && mode !== "candidate") throw new Error("BETTER_NATIVE_MODE is required")
if (!buildId) throw new Error("BETTER_NATIVE_BUILD_ID is required")
if (!runId) throw new Error("BETTER_NATIVE_RUN_ID is required")
if (!upstreamNodeModulesPath) throw new Error("BETTER_NATIVE_UPSTREAM_NODE_MODULES is required")
const pinnedExpoRoot = process.env.BETTER_NATIVE_PINNED_EXPO_ROOT
if (!pinnedExpoRoot) throw new Error("BETTER_NATIVE_PINNED_EXPO_ROOT is required")
const expoSourceRoot = process.env.EXPO_SOURCE_ROOT ?? path.resolve(__dirname, "../../../expo")

const { getDefaultConfig } = require(path.join(pinnedExpoRoot, "packages", "expo", "metro-config"))

const config = getDefaultConfig(__dirname)
if (!config.resolver.assetExts.includes("wasm")) config.resolver.assetExts.push("wasm")
config.watchFolders = [...new Set([...(config.watchFolders ?? []), expoSourceRoot])]
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@better-native/expo-source": expoSourceRoot,
}

module.exports = withBetterNative(config, {
  mode,
  buildId,
  runId,
  ownershipFingerprint: generated.ownershipFingerprint,
  upstreamNodeModulesPath,
  replacements: generated.replacements,
  trackedSpecifiers: generated.trackedSpecifiers,
  onResolution(event) {
    if (trackedSpecifiers.has(event.specifier)) {
      console.log(`BETTER_NATIVE_RESOLUTION_V1=${JSON.stringify(event)}`)
    }
  },
})
