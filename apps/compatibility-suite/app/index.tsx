import { Link } from "expo-router"
import { StyleSheet, Text, View } from "react-native"
import { metadata, registry } from "../src/Registry.ts"

export default function Index() {
  const appRunnable = registry.filter(({ load }) => load !== null).length
  return (
    <View style={styles.container} testID="compatibility_registry_ready">
      <Text style={styles.eyebrow}>PINNED EXPO {metadata.expoRevision.slice(0, 12)}</Text>
      <Text style={styles.title}>Compatibility suite</Text>
      <Text style={styles.metric}>{registry.length.toLocaleString()} indexed sources</Text>
      <Text style={styles.detail}>{appRunnable} app-runnable sources on this platform</Text>
      <Link href="/run" style={styles.link}>
        Run Basic, Battery, and Network smoke cases
      </Link>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 32, backgroundColor: "#f2f0e9" },
  eyebrow: { fontSize: 12, letterSpacing: 1.4, color: "#69675f", marginBottom: 12 },
  title: { fontSize: 38, fontWeight: "700", color: "#171713", marginBottom: 28 },
  metric: { fontSize: 24, color: "#171713" },
  detail: { fontSize: 16, color: "#69675f", marginTop: 6, marginBottom: 32 },
  link: { fontSize: 17, color: "#174f3a", textDecorationLine: "underline" },
})
