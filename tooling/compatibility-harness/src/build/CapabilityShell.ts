/** Reviewed source IDs supported by capability-scoped native shells. */
export const capabilityShellSourceIds = {
  clipboard: "better-native-capability#apps/compatibility-suite/src/capabilities/Clipboard.ts",
  location: "better-native-capability#apps/compatibility-suite/src/capabilities/Location.ts",
  notifications:
    "better-native-capability#apps/compatibility-suite/src/capabilities/Notifications.ts",
  sqlite: "better-native-capability#apps/compatibility-suite/src/capabilities/SQLite.ts",
} as const

export interface CapabilityShell {
  readonly sourceId: string
  readonly module: string
  readonly eager: boolean
  readonly dependencies: ReadonlyArray<string>
  readonly plugins: ReadonlyArray<string | readonly [string, Readonly<Record<string, unknown>>]>
}

const baseDependencies = [
  "@better-native/metro",
  "effect",
  "expo",
  "expo-constants",
  "expo-file-system",
  "expo-observe",
  "expo-router",
  "jasmine-core",
  "react",
  "react-native",
  "react-native-safe-area-context",
  "react-native-screens",
] as const

/** Native-shell catalog kept deliberately small and reviewed per capability. */
export const capabilityShells: ReadonlyMap<string, CapabilityShell> = new Map([
  [
    capabilityShellSourceIds.clipboard,
    {
      sourceId: capabilityShellSourceIds.clipboard,
      module: "../capabilities/Clipboard.ts",
      eager: false,
      dependencies: [...baseDependencies, "@better-native/clipboard", "expo-clipboard"],
      plugins: ["expo-router"],
    },
  ],
  [
    capabilityShellSourceIds.location,
    {
      sourceId: capabilityShellSourceIds.location,
      module: "../capabilities/Location.ts",
      eager: false,
      dependencies: [...baseDependencies, "@better-native/location", "expo-location"],
      plugins: [
        "expo-router",
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
    },
  ],
  [
    capabilityShellSourceIds.sqlite,
    {
      sourceId: capabilityShellSourceIds.sqlite,
      module: "../capabilities/SQLite.ts",
      eager: false,
      dependencies: [...baseDependencies, "@better-native/sqlite", "expo-sqlite"],
      plugins: ["expo-router"],
    },
  ],
  [
    capabilityShellSourceIds.notifications,
    {
      sourceId: capabilityShellSourceIds.notifications,
      module: "../capabilities/Notifications.ts",
      eager: true,
      dependencies: [
        ...baseDependencies,
        "@better-native/notifications",
        "@better-native/task-manager",
        "expo-notifications",
        "expo-task-manager",
      ],
      plugins: [
        "expo-router",
        ["expo-notifications", { enableBackgroundRemoteNotifications: true }],
      ],
    },
  ],
])

/** Returns the reviewed scoped shell, or `null` for the periodic full-suite shell. */
export const capabilityShell = (sourceId: string | undefined): CapabilityShell | null => {
  if (sourceId === undefined) return null
  const shell = capabilityShells.get(sourceId)
  if (shell === undefined)
    throw new Error(`no capability-scoped native shell is reviewed for ${sourceId}`)
  return shell
}

/** Restricts an isolated app manifest to one reviewed shell's direct runtime dependencies. */
export const scopeCapabilityManifest = (
  manifest: Readonly<Record<string, unknown>>,
  shell: CapabilityShell,
): Record<string, unknown> => {
  const declared = manifest.dependencies
  if (declared === null || typeof declared !== "object" || Array.isArray(declared)) {
    throw new Error("compatibility app dependencies must contain an object")
  }
  const versions = declared as Readonly<Record<string, unknown>>
  const dependencies = Object.fromEntries(
    shell.dependencies.map((name) => {
      const version = versions[name]
      if (typeof version !== "string") {
        throw new Error(`scoped shell dependency is not declared by the app: ${name}`)
      }
      return [name, version]
    }),
  )
  return { ...manifest, dependencies }
}
