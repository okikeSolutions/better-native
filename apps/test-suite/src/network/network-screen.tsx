import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useNetworkProbe } from "./use-network-probe"

const panel = {
  backgroundColor: "#15171c",
  borderRadius: 18,
  borderCurve: "continuous" as const,
  padding: 18,
  gap: 10
}

const sessionInstruction = (
  phase: ReturnType<typeof useNetworkProbe>["changesSession"]["phase"]
): string => {
  switch (phase) {
    case "idle":
      return "Start a scoped listener, then change Wi-Fi, airplane mode, or serve-sim connectivity."
    case "awaiting-first":
      return "Pending first delivery: make one real connectivity change."
    case "awaiting-subsequent":
      return "Pending subsequent delivery: make a distinct second connectivity change."
    case "ready-to-cleanup":
      return "Two events arrived. Waiting for the Effect scoped stream to finish finalization."
    case "ready-to-resubscribe":
      return "Cleanup completed. Start a fresh Effect stream subscription, then change connectivity again."
    case "awaiting-resubscribed":
      return "Pending resubscribe evidence: make one more real connectivity change."
    case "stopping":
      return "Stopping the owned stream fiber before another session can start."
    case "complete":
      return "Session complete. These are session observations, not recorded platform verification."
    case "failed":
      return "The pending vector failed or the session was stopped. You can start a new session."
  }
}

const evidenceColor = (status: "pending" | "passed" | "failed"): string =>
  status === "passed" ? "#91f2cd" : status === "pending" ? "#f4cf75" : "#ff9b9b"

export function NetworkScreen() {
  const probe = useNetworkProbe()

  return (
    <>
      <Stack.Screen options={{ title: "Network Conformance" }} />
      <StatusBar style="auto" />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 18, gap: 16, backgroundColor: "#090a0d" }}
      >
        <View style={panel}>
          <Text selectable style={{ color: "#8b93a7", fontSize: 13, fontWeight: "600" }}>
            LIVE EFFECT SERVICE
          </Text>
          <Text selectable style={{ color: "#f7f8fa", fontSize: 28, fontWeight: "700" }}>
            {probe.current?.type ?? "Loading…"}
          </Text>
          <Text selectable style={{ color: "#c9ced9", fontSize: 16 }}>
            Connected: {String(probe.current?.isConnected ?? "—")}
          </Text>
          <Text selectable style={{ color: "#c9ced9", fontSize: 16 }}>
            Internet reachable: {String(probe.current?.isInternetReachable ?? "—")}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: probe.conformanceRunning }}
          disabled={probe.conformanceRunning}
          onPress={probe.runConformance}
          style={({ pressed }) => ({
            backgroundColor: probe.conformanceRunning ? "#52665f" : pressed ? "#72d5b0" : "#91f2cd",
            borderRadius: 14,
            borderCurve: "continuous",
            padding: 16
          })}
        >
          <Text selectable style={{ color: "#08251b", fontSize: 16, fontWeight: "700" }}>
            {probe.conformanceRunning
              ? "Running current-state vectors…"
              : "Run current-state vectors"}
          </Text>
        </Pressable>

        <View style={panel}>
          <Text selectable style={{ color: "#f7f8fa", fontSize: 19, fontWeight: "700" }}>
            Interactive listener observations
          </Text>
          <Text selectable style={{ color: "#c9ced9", lineHeight: 20 }}>
            The app cannot control iOS or Android connectivity. Each delivery remains pending until
            you toggle the simulator/device network. If serve-sim installed the iOS build, change
            connectivity manually in the simulator. Scoped-stream finalization only proves Effect
            cleanup completed; it does not prove Expo or OS listener deregistration, and platform
            verification remains unverified.
          </Text>
          <Text selectable style={{ color: "#91f2cd", fontWeight: "600" }}>
            {probe.changesSession.phase.toUpperCase()}
          </Text>
          <Text selectable style={{ color: "#c9ced9" }}>
            {sessionInstruction(probe.changesSession.phase)}
          </Text>

          {probe.changesSession.phase === "ready-to-resubscribe" ? (
            <Pressable
              accessibilityRole="button"
              onPress={probe.startChangesResubscription}
              style={{ backgroundColor: "#91f2cd", borderRadius: 12, padding: 14 }}
            >
              <Text style={{ color: "#08251b", fontWeight: "700" }}>Start fresh Effect stream</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={
                probe.changesSession.phase !== "idle" &&
                probe.changesSession.phase !== "complete" &&
                probe.changesSession.phase !== "failed"
              }
              onPress={probe.startChangesConformance}
              style={{
                backgroundColor:
                  probe.changesSession.phase === "idle" ||
                  probe.changesSession.phase === "complete" ||
                  probe.changesSession.phase === "failed"
                    ? "#91f2cd"
                    : "#52665f",
                borderRadius: 12,
                padding: 14
              }}
            >
              <Text style={{ color: "#08251b", fontWeight: "700" }}>Start listener session</Text>
            </Pressable>
          )}

          {probe.changesSession.phase !== "idle" &&
            probe.changesSession.phase !== "complete" &&
            probe.changesSession.phase !== "failed" &&
            probe.changesSession.phase !== "stopping" && (
              <Pressable
                accessibilityRole="button"
                onPress={probe.stopChangesConformance}
                style={{ borderColor: "#ff9b9b", borderRadius: 12, borderWidth: 1, padding: 14 }}
              >
                <Text style={{ color: "#ff9b9b", fontWeight: "700" }}>
                  Stop and fail pending vector
                </Text>
              </Pressable>
            )}

          {probe.changesSession.results.map((item) => (
            <View key={item.id} style={{ gap: 4 }}>
              <Text style={{ color: evidenceColor(item.status) }}>
                {item.status.toUpperCase()} · {item.id}
              </Text>
              <Text selectable style={{ color: "#8b93a7" }}>
                {item.detail}
              </Text>
            </View>
          ))}
        </View>

        {probe.error !== undefined && (
          <View style={{ ...panel, borderColor: "#ff6b6b", borderWidth: 1 }}>
            <Text selectable style={{ color: "#ff9b9b", fontFamily: "monospace" }}>
              {probe.error}
            </Text>
          </View>
        )}

        <View style={panel}>
          <Text selectable style={{ color: "#f7f8fa", fontSize: 19, fontWeight: "700" }}>
            Conformance evidence
          </Text>
          {probe.conformance.length === 0 ? (
            <Text selectable style={{ color: "#8b93a7" }}>
              No live run recorded in this session.
            </Text>
          ) : (
            probe.conformance.map((item) => (
              <View key={item.id} style={{ gap: 4 }}>
                <Text selectable style={{ color: evidenceColor(item.status) }}>
                  {item.status.toUpperCase()} · {item.id}
                </Text>
                <Text selectable style={{ color: "#8b93a7" }}>
                  {item.detail}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={panel}>
          <Text selectable style={{ color: "#f7f8fa", fontSize: 19, fontWeight: "700" }}>
            Scoped transitions
          </Text>
          {probe.transitions.length === 0 ? (
            <Text selectable style={{ color: "#8b93a7" }}>
              Change Wi-Fi or airplane mode to produce an event.
            </Text>
          ) : (
            probe.transitions.map((state, index) => (
              <Text
                selectable
                key={`${state.type}-${index}`}
                style={{ color: "#c9ced9", fontFamily: "monospace" }}
              >
                {state.type} · connected={String(state.isConnected)} · reachable=
                {String(state.isInternetReachable)}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </>
  )
}
