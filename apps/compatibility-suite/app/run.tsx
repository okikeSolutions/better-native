import { useLocalSearchParams } from "expo-router"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import * as Match from "effect/Match"
import { registry } from "../src/Registry.ts"
import { run, type RunSummary } from "../src/Runner.ts"
import { runtime } from "../src/Runtime.ts"

const smokeCaseIds = registry
  .filter(({ path }) => /\/tests\/(?:Basic|Network)\.[^.]+$/.test(path))
  .flatMap(({ caseIds }) => caseIds)

export default function Run() {
  const params = useLocalSearchParams<{
    case?: string | Array<string>
    runId?: string
    source?: string | Array<string>
  }>()
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [portalChild, setPortalChild] = useState<ReactNode>(null)
  const caseIds = useMemo(() => {
    if (params.case === undefined) return smokeCaseIds
    return (Array.isArray(params.case) ? params.case : [params.case]).filter(Boolean)
  }, [params.case])
  const sourceIds = useMemo(
    () =>
      params.source === undefined
        ? []
        : (Array.isArray(params.source) ? params.source : [params.source]).filter(Boolean),
    [params.source],
  )

  useEffect(() => {
    let active = true
    runtime
      .runPromise(
        run(
          {
            schemaVersion: 1,
            runId: params.runId ?? "interactive-run",
            caseIds,
            sourceIds,
          },
          {
            setPortalChild,
            cleanupPortal: () =>
              new Promise<void>((resolve) => {
                setPortalChild(null)
                requestAnimationFrame(() => resolve())
              }),
          },
        ),
      )
      .then((result) => {
        if (active) setSummary(result)
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? (cause.stack ?? cause.message) : String(cause))
      })
    return () => {
      active = false
    }
  }, [caseIds, params.runId, sourceIds])

  const failed =
    summary?.results.filter(({ outcome }) =>
      Match.value(outcome).pipe(
        Match.tag("failed", () => true),
        Match.orElse(() => false),
      ),
    ).length ?? 0
  return (
    <ScrollView contentContainerStyle={styles.container} testID="compatibility_run">
      <Text style={styles.title}>Run {params.runId ?? "interactive-run"}</Text>
      {error ? <Text testID="compatibility_run_error">{error}</Text> : null}
      {summary === null && error === null ? (
        <Text testID="compatibility_run_running">Running {caseIds.length} cases…</Text>
      ) : null}
      {summary ? (
        <View testID="compatibility_run_complete">
          <Text testID="compatibility_run_summary">
            {summary.mode} · {summary.buildId} · {summary.results.length} results · {failed} failed
          </Text>
          <Text selectable style={styles.result} testID="compatibility_run_result_json">
            {JSON.stringify(summary)}
          </Text>
        </View>
      ) : null}
      <View testID="compatibility_test_portal">{portalChild}</View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 28, backgroundColor: "#f2f0e9" },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 24 },
  result: { fontFamily: "monospace", fontSize: 11, marginTop: 20 },
})
