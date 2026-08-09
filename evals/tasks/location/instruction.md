# Location

Implement `src/ObserveLocation.ts` using only the installed public `@better-native/location`
package and normal `effect/*` entrypoints.

Export `observeLocation`, one Effect with `Location.live` already provided. Consume exactly the
first value from `Location.watchPositionAsync` with balanced accuracy and return its latitude.
The exported Effect must have no remaining service requirements. Stream completion must release
the native subscription. Do not import `expo-location`, Better Native source files, package
internals, or test doubles directly. Do not add files or change the exported name.
