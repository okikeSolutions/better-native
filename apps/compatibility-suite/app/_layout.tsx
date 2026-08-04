import { Stack } from "expo-router"
import { Observe } from "expo-observe"
import "../src/generated/EagerRegistrations"
import "../src/generated/UpstreamSelection"

Observe.configure({ dispatchingEnabled: false })

export default function Layout() {
  return <Stack screenOptions={{ headerTitle: "Better Native Compatibility" }} />
}
