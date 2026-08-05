import { useLocalSearchParams } from "expo-router"
import { type ReactNode, useEffect, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import * as Encoding from "effect/Encoding"
import * as Match from "effect/Match"
import * as Result from "effect/Result"
import { run, type RunSummary } from "../src/Runner.ts"
import type { RunnerProgress } from "../src/Registry.ts"
import { runtime } from "../src/Runtime.ts"

const selectionFor = (
  runId: string,
  sourceId: string | undefined,
  cohort: string | undefined,
  sources: string | undefined,
): unknown => {
  if (sourceId !== undefined) return { schemaVersion: 1, runId, sourceId }
  if (sources !== undefined) {
    const sourceIds = sources
      .split(",")
      .map((encoded) =>
        Result.getOrThrowWith(
          Encoding.decodeHexString(encoded),
          () => new Error("invalid source list"),
        ),
      )
    return { schemaVersion: 1, runId, sourceIds }
  }
  if (cohort === "native-e2e") return { schemaVersion: 1, runId, cohort }
  return { schemaVersion: 1, runId, cohort: "interactive-smoke" }
}

export const formatRunError = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null && "reason" in cause) {
    const reason = Reflect.get(cause, "reason")
    const tag = "_tag" in cause ? Reflect.get(cause, "_tag") : "CompatibilityError"
    if (typeof reason === "string") return `${String(tag)}: ${reason}`
  }
  return cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)
}

export default function Run() {
  const params = useLocalSearchParams<{
    runId?: string
    source?: string
    cohort?: string
    sources?: string
  }>()
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<RunnerProgress | null>(null)
  const [portalChild, setPortalChild] = useState<ReactNode>(null)
  const runId = params.runId ?? "interactive-run"
  const sourceId = typeof params.source === "string" ? params.source : undefined
  const cohort = typeof params.cohort === "string" ? params.cohort : undefined
  const sources = typeof params.sources === "string" ? params.sources : undefined
  const selectionIdentity =
    sources === undefined ? (sourceId ?? cohort ?? "interactive-smoke") : "native-e2e"

  useEffect(() => {
    let active = true
    Promise.resolve()
      .then(() => selectionFor(runId, sourceId, cohort, sources))
      .then((input) =>
        runtime.runPromise(
          run(input, {
            setPortalChild,
            setProgress,
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
        if (active) setError(formatRunError(cause))
      })
    return () => {
      active = false
    }
  }, [cohort, params.runId, runId, sourceId, sources])

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
      <Text testID="compatibility_run_selection">{selectionIdentity}</Text>
      {progress ? (
        <Text testID="compatibility_run_progress">
          {progress.phase} · {progress.sourceId}
          {progress.caseId ? ` · ${progress.caseId}` : ""}
        </Text>
      ) : null}
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
