import { useLocalSearchParams } from "expo-router"
import { type ReactNode, useEffect, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import * as Match from "effect/Match"
import { registry } from "../src/Registry.ts"
import { run, type RunSummary } from "../src/Runner.ts"
import { runtime } from "../src/Runtime.ts"

const smokeCaseIds = registry
  .filter(({ path }) => /\/tests\/(?:Basic|Network)\.[^.]+$/.test(path))
  .flatMap(({ caseIds }) => caseIds)

const smokeSourceId = registry.find(({ caseIds }) =>
  caseIds.some((caseId) => smokeCaseIds.includes(caseId)),
)?.sourceId

const selectionFor = (runId: string, sourceId: string | undefined): unknown => {
  if (sourceId !== undefined) return { schemaVersion: 1, runId, sourceId }
  if (smokeSourceId !== undefined) return { schemaVersion: 1, runId, sourceId: smokeSourceId }
  throw new Error("the static compatibility registry has no interactive smoke source")
}

export default function Run() {
  const params = useLocalSearchParams<{
    runId?: string
    source?: string
  }>()
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [portalChild, setPortalChild] = useState<ReactNode>(null)
  const runId = params.runId ?? "interactive-run"
  const sourceId = typeof params.source === "string" ? params.source : undefined

  useEffect(() => {
    let active = true
    Promise.resolve(selectionFor(runId, sourceId))
      .then((input) =>
        runtime.runPromise(
          run(input, {
            setPortalChild,
            cleanupPortal: () =>
              new Promise<void>((resolve) => {
                setPortalChild(null)
                requestAnimationFrame(() => resolve())
              }),
          }),
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
  }, [params.runId, runId, sourceId])

  const failed =
    summary?.results.filter(({ outcome }) =>
      Match.value(outcome).pipe(
        Match.tag("failed", () => true),
        Match.orElse(() => false),
      ),
    ).length ?? 0
  return (
    <ScrollView contentContainerStyle={styles.container} testID="compatibility_run">
      <Text style={styles.title}>Run {runId}</Text>
      {error ? <Text testID="compatibility_run_error">{error}</Text> : null}
      {summary === null && error === null ? (
        <Text testID="compatibility_run_running">Loading compatibility run…</Text>
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
