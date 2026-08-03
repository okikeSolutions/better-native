import type { ExpoConfig } from "expo/config"
import { fileURLToPath } from "node:url"

const pinnedExpoRoot =
  process.env.BETTER_NATIVE_PINNED_EXPO_ROOT ??
  fileURLToPath(new URL("../../vendor/expo", import.meta.url))
const plugin = (name: string) => `${pinnedExpoRoot}/packages/${name}/app.plugin.js`
const bareAsset = (name: string) => `${pinnedExpoRoot}/apps/bare-expo/assets/${name}`

const config: ExpoConfig = {
  name: "Better Native Compatibility",
  slug: "better-native-compatibility",
  scheme: "better-native",
  version: "1.0.0",
  orientation: "default",
  platforms: ["ios", "android", "web"],
  ios: {
    bundleIdentifier: "dev.betternative.compatibility",
    entitlements: {
      "com.apple.security.application-groups": ["group.dev.expo.Payments"],
    },
    infoPlist: {
      NSCalendarsFullAccessUsageDescription: "Allow the compatibility suite to access calendars",
      NSCalendarsUsageDescription: "Allow the compatibility suite to access calendars",
      NSCameraUsageDescription: "Allow the compatibility suite to access the camera",
      NSContactsUsageDescription: "Allow the compatibility suite to access contacts",
      NSFaceIDUsageDescription: "Allow the compatibility suite to use Face ID",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Allow the compatibility suite to access location in the background",
      NSLocationWhenInUseUsageDescription: "Allow the compatibility suite to access location",
      NSMicrophoneUsageDescription: "Allow the compatibility suite to access the microphone",
      NSMotionUsageDescription: "Allow the compatibility suite to access device motion",
      NSPhotoLibraryAddUsageDescription: "Allow the compatibility suite to save photos",
      NSPhotoLibraryUsageDescription: "Allow the compatibility suite to access photos",
      NSRemindersFullAccessUsageDescription: "Allow the compatibility suite to access reminders",
      UIBackgroundModes: ["fetch", "audio", "location", "processing"],
    },
  },
  android: {
    package: "dev.betternative.compatibility",
    permissions: [
      "ACCESS_BACKGROUND_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "CAMERA",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      "FOREGROUND_SERVICE_MICROPHONE",
      "POST_NOTIFICATIONS",
      "READ_CALENDAR",
      "READ_CONTACTS",
      "RECORD_AUDIO",
      "USE_BIOMETRIC",
      "VIBRATE",
      "WAKE_LOCK",
      "WRITE_CALENDAR",
      "WRITE_CONTACTS",
    ],
  },
  web: { bundler: "metro", output: "static" },
  plugins: [
    plugin("expo-router"),
    plugin("expo-video"),
    plugin("expo-background-fetch"),
    plugin("expo-background-task"),
    [plugin("expo-font"), { fonts: [bareAsset("icomoon.ttf")] }],
    [
      plugin("expo-notifications"),
      {
        icon: bareAsset("ic_stat_notifications.png"),
        color: "#4630EB",
        sounds: [bareAsset("notification.wav")],
      },
    ],
    [
      plugin("expo-location"),
      {
        isAndroidBackgroundLocationEnabled: true,
        isIosBackgroundLocationEnabled: true,
        androidForegroundServiceIcon: bareAsset("location_service_icon.png"),
      },
    ],
    [
      plugin("expo-tracking-transparency"),
      { userTrackingPermission: "Allow the compatibility suite to test tracking permission" },
    ],
    [plugin("expo-web-browser"), { experimentalLauncherActivity: true }],
    [plugin("expo-build-properties"), { android: { enableMinifyInReleaseBuilds: true } }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    eas: { projectId: "2c28de10-a2cd-11e6-b8ce-59d1587e6774" },
    betterNativeMode: process.env.BETTER_NATIVE_MODE,
    betterNativeBuildId: process.env.BETTER_NATIVE_BUILD_ID,
  },
}

export default config
