import * as Base64Url from "effect/encoding/Base64Url"
import * as FileSystem from "expo-file-system/legacy"
import type { RunSummary } from "./Runner.ts"

export const rendersResultPayload = false

export const resultFileName = (runId: string): string =>
  `better-native-result-${Base64Url.encode(runId)}.json`

export const publishResult = (runId: string, result: RunSummary): Promise<void> => {
  if (FileSystem.documentDirectory === null)
    return Promise.reject(new Error("document directory unavailable"))
  return FileSystem.writeAsStringAsync(
    `${FileSystem.documentDirectory}${resultFileName(runId)}`,
    JSON.stringify(result),
  )
}
