/** Current on-disk schema version for complete CocoaPods dependency trees. */
export const podsCacheSchemaVersion = 3 as const

/** Current CocoaPods cache directory name. */
export const podsCacheDirectory = `v${podsCacheSchemaVersion}` as const

/** Current on-disk schema version for reusable native application shells. */
export const nativeArtifactCacheSchemaVersion = 1 as const

/** Current native application-shell cache directory name. */
export const nativeArtifactCacheDirectory = `v${nativeArtifactCacheSchemaVersion}` as const
