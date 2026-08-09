import taskManagerPlugin from "expo-task-manager/app.plugin.js"

/** Expo Task Manager config-plugin bridge with stable ESM/CommonJS default interop. */
const plugin: typeof taskManagerPlugin =
  typeof taskManagerPlugin === "function"
    ? taskManagerPlugin
    : (taskManagerPlugin as unknown as { readonly default: typeof taskManagerPlugin }).default

export default plugin
