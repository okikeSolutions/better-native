import type { NativeRunRequest } from "./NativeSupervisor.ts"

const yamlString = (value: string): string => JSON.stringify(value)

/**
 * Selects one static registry source after the Effect supervisor has reset,
 * installed, granted permissions to, and launched the application.
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

export const makeBatch = (request: NativeRunRequest): string => {
  const link = `better-native://run?${new URLSearchParams({
    runId: request.id,
    cohort: "native-e2e",
  }).toString()}`
  return [
    `appId: ${request.device.applicationId}`,
    "jsEngine: graaljs",
    "---",
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
