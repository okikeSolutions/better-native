import type { NativeRunRequest } from "./NativeSupervisor.ts"

const yamlString = (value: string): string => JSON.stringify(value)

/**
 * Mirrors Expo's generated test-suite flow, but selects one static registry
 * source. The source is expanded by the application; no case list crosses the
 * native deep-link boundary.
 */
export const make = (request: NativeRunRequest): string => {
  const link = `better-native://run?${new URLSearchParams({
    runId: request.id,
    source: request.unit.sourceId,
  }).toString()}`
  return [
    `appId: ${request.device.applicationId}`,
    "jsEngine: graaljs",
    "---",
    "- clearState",
    `- openLink: ${yamlString(link)}`,
    "- extendedWaitUntil:",
    "    visible:",
    '      id: "compatibility_run"',
    "    timeout: 30000",
    "- extendedWaitUntil:",
    "    visible:",
    '      id: "compatibility_run_complete"',
    `    timeout: ${Math.max(30_000, request.timeoutMillis)}`,
    "- assertNotVisible:",
    '    id: "compatibility_run_error"',
    "",
  ].join("\n")
}
