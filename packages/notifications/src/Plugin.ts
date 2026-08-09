import notificationsPlugin from "expo-notifications/app.plugin.js"

/** Expo Notifications config-plugin bridge with stable ESM/CommonJS default interop. */
const plugin: typeof notificationsPlugin =
  typeof notificationsPlugin === "function"
    ? notificationsPlugin
    : (notificationsPlugin as { readonly default: typeof notificationsPlugin }).default

export default plugin
