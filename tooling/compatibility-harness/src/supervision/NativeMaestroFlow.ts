import * as Encoding from "effect/Encoding"
import type { NativeBatchRequest, NativeRunRequest } from "./NativeSupervisor.ts"

const yamlString = (value: string): string => JSON.stringify(value)

const selectionAssertion = (identity: string): ReadonlyArray<string> => [
  "- extendedWaitUntil:",
  "    visible:",
  '      id: "compatibility_run_selection"',
  `      text: ${yamlString(identity)}`,
  "    timeout: 30000",
]

/**
 * Selects one static registry source after the Effect supervisor installs the
 * application. Maestro owns state reset and cold launch, matching Expo's suite.
 *
 * @param request - Native run request containing the selected execution unit.
 * @returns Complete Maestro YAML for the source run.
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
    ...selectionAssertion(request.unit.sourceId),
    "- extendedWaitUntil:",
    "    visible:",
    '      id: "compatibility_run_complete"',
    `    timeout: ${Math.max(30_000, request.timeoutMillis)}`,
    "- assertNotVisible:",
    '    id: "compatibility_run_error"',
    "",
  ].join("\n")
}

const encodeSourceId = (sourceId: string): string => Encoding.encodeHex(sourceId)

/**
 * Generates a Maestro flow for one native source cohort.
 *
 * @remarks
 * Source IDs are hex encoded into the deep link so separators cannot make the
 * batch ambiguous. Maestro owns state reset and cold launch for parity with Expo.
 *
 * @param request - Native batch request containing the selected execution units.
 * @returns Complete Maestro YAML for the cohort run.
 */
export const makeBatch = (request: NativeBatchRequest): string => {
  const link = `better-native://run?${new URLSearchParams({
    runId: request.id,
    sources: request.units.map(({ sourceId }) => encodeSourceId(sourceId)).join(","),
  }).toString()}`
  return [
    `appId: ${request.device.applicationId}`,
    "jsEngine: graaljs",
    "---",
    "- clearState",
    `- openLink: ${yamlString(link)}`,
    ...selectionAssertion("native-e2e"),
    "- extendedWaitUntil:",
    "    visible:",
    '      id: "compatibility_run_complete"',
    `    timeout: ${Math.max(30_000, request.timeoutMillis)}`,
    "- assertNotVisible:",
    '    id: "compatibility_run_error"',
    "",
  ].join("\n")
}
