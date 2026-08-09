import backgroundTaskPlugin from "expo-background-task/app.plugin.js"

/** Expo Background Task config-plugin bridge with stable ESM/CommonJS default interop. */
const plugin: typeof backgroundTaskPlugin =
  typeof backgroundTaskPlugin === "function"
    ? backgroundTaskPlugin
    : (backgroundTaskPlugin as unknown as { readonly default: typeof backgroundTaskPlugin }).default

export default plugin
