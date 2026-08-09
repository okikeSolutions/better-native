import sqlitePlugin from "expo-sqlite/plugin"

/** Expo-compatible config plugin bridge with stable ESM/CommonJS default interop. @since 0.0.0 */
const plugin: typeof sqlitePlugin =
  typeof sqlitePlugin === "function"
    ? sqlitePlugin
    : (sqlitePlugin as unknown as { readonly default: typeof sqlitePlugin }).default

export default plugin
