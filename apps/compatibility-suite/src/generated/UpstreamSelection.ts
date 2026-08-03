import { configureUpstreamSelection } from "../Registry.ts"

// Kept in an app-only module: invoking the pinned function preserves its
// platform, Expo Go, device-farm, WebGL, optional-module and eager-load gates.
const upstream: unknown = require("@better-native/expo-source/apps/test-suite/TestModules")
const getter: unknown = typeof upstream === "object" && upstream !== null
  ? Reflect.get(upstream, "getTestModules")
  : undefined
if (typeof getter !== "function") throw new Error("Pinned Expo TestModules.getTestModules is unavailable")
const modules: unknown = Reflect.apply(getter, upstream, [])
if (!Array.isArray(modules)) throw new Error("Pinned Expo getTestModules returned a non-array")
const names = modules.flatMap((module: unknown) => {
  if (typeof module !== "object" || module === null) return []
  const name: unknown = Reflect.get(module, "name")
  return typeof name === "string" ? [name] : []
})
configureUpstreamSelection(names)
