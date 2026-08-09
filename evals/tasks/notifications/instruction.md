# Notifications

Implement `src/ObserveNotifications.ts` using only the installed public
`@better-native/notifications` package and normal `effect/*` entrypoints.

Export `observeNotification`, one Effect with `Notifications.live` already provided. Consume
exactly the first value from `Notifications.addNotificationReceivedListener` and return its request
identifier. The exported Effect must have no remaining service requirements. Stream completion
must remove the native subscription. Do not import `expo-notifications`, Better Native source
files, package internals, or test doubles directly. Do not add files or change the exported name.
