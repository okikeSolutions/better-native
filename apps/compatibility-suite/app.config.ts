import type { ExpoConfig } from "expo/config"

const compatibilityProjectId = "00000000-0000-4000-8000-000000000000"

const config: ExpoConfig = {
  name: "Better Native Compatibility",
  slug: "better-native-compatibility",
  scheme: "better-native",
  version: "1.0.0",
  platforms: ["ios", "android", "web"],
  ios: { bundleIdentifier: "dev.betternative.compatibility" },
  android: { package: "dev.betternative.compatibility" },
  web: { bundler: "metro", output: "static" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-background-task",
    [
      "expo-notifications",
      {
        enableBackgroundRemoteNotifications: true,
      },
    ],
    [
      "expo-location",
      {
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isAndroidMotionActivityEnabled: true,
      },
    ],
  ],
  experiments: { autolinkingModuleResolution: true, typedRoutes: true },
  extra: {
    eas: { projectId: compatibilityProjectId },
    betterNativeMode: process.env.BETTER_NATIVE_MODE,
    betterNativeBuildId: process.env.BETTER_NATIVE_BUILD_ID,
  },
}

export default config
