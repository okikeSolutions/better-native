import locationPlugin from "expo-location/app.plugin.js"

/** Expo Location config-plugin bridge with stable ESM/CJS default interop. */
const plugin: typeof locationPlugin =
  typeof locationPlugin === "function"
    ? locationPlugin
    : (locationPlugin as unknown as { readonly default: typeof locationPlugin }).default

export default plugin
