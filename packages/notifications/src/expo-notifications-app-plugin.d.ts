declare module "expo-notifications/app.plugin.js" {
  import type { ConfigPlugin } from "expo/config-plugins"
  const plugin: ConfigPlugin<Record<string, unknown> | void>
  export default plugin
}
