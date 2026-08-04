import type { ExpoConfig } from "expo/config"

const config: ExpoConfig = {
  name: "Better Native Compatibility",
  slug: "better-native-compatibility",
  scheme: "better-native",
  version: "1.0.0",
  platforms: ["ios", "android", "web"],
  ios: { bundleIdentifier: "dev.betternative.compatibility" },
  android: { package: "dev.betternative.compatibility" },
  web: { bundler: "metro", output: "static" },
  plugins: ["expo-router"],
  experiments: { autolinkingModuleResolution: true, typedRoutes: true },
  extra: {
    betterNativeMode: process.env.BETTER_NATIVE_MODE,
    betterNativeBuildId: process.env.BETTER_NATIVE_BUILD_ID,
  },
}

export default config
