import { useLocalSearchParams } from "expo-router"
import { useEffect, useState } from "react"
import { ScrollView, StyleSheet, Text } from "react-native"
import * as Arr from "effect/Array"
import * as Order from "effect/Order"
import * as Schema from "effect/Schema"
import { surfaceProbes } from "../src/SurfaceProbes.ts"

const ProbeResult = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  specifier: Schema.String,
  outcome: Schema.Literals(["loaded", "failed"]),
  exports: Schema.Array(Schema.String),
  detail: Schema.NullOr(Schema.String),
})

type ProbeResult = Schema.Schema.Type<typeof ProbeResult>

const inspect = (value: unknown): ReadonlyArray<string> => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return []
  return Arr.sort(Object.keys(value), Order.String)
}

export default function Discover() {
  const { specifier = "" } = useLocalSearchParams<{ specifier?: string }>()
  const [result, setResult] = useState<ProbeResult | null>(null)
  useEffect(() => {
    const load = surfaceProbes.get(specifier)
    let next: ProbeResult
    if (load === undefined) {
      next = {
        schemaVersion: 1,
        specifier,
        outcome: "failed",
        exports: [],
        detail: "specifier is not registered for this platform",
      }
    } else {
      try {
        next = {
          schemaVersion: 1,
          specifier,
          outcome: "loaded",
          exports: [...inspect(load())],
          detail: null,
        }
      } catch (cause) {
        next = {
          schemaVersion: 1,
          specifier,
          outcome: "failed",
          exports: [],
          detail: cause instanceof Error ? cause.message : String(cause),
        }
      }
    }
    const decoded = Schema.decodeUnknownSync(ProbeResult)(next)
    console.log(`BETTER_NATIVE_EXPORT_V1=${JSON.stringify(decoded)}`)
    setResult(decoded)
  }, [specifier])
  return (
    <ScrollView contentContainerStyle={styles.container} testID="compatibility_discovery">
      <Text style={styles.title}>Surface discovery</Text>
      {result === null ? <Text>Loading…</Text> : null}
      {result !== null ? (
        <Text selectable testID="compatibility_discovery_result_json">
          {JSON.stringify(result)}
        </Text>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 28, backgroundColor: "#f2f0e9" },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 24 },
})
