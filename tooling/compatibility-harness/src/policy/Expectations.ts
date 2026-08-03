import * as Effect from "effect/Effect"
import { Expectations } from "../Domain.ts"
import { ExpoRepository } from "../ExpoRepository.ts"
import { HarnessError } from "../HarnessError.ts"

export const load = Effect.fn("Expectations.load")(function* () {
  const repository = yield* ExpoRepository
  const expectations = yield* repository.readJson("compatibility/expectations.json", Expectations)
  if (expectations.expoRevision !== repository.upstreams.expo.revision) {
    return yield* new HarnessError({
      operation: "validate expectation revision",
      path: "compatibility/expectations.json",
      cause: `found ${expectations.expoRevision}; expected ${repository.upstreams.expo.revision}`,
    })
  }
  const seen = new Set<string>()
  for (const entry of expectations.entries) {
    const key = `${entry.caseId}#${entry.platforms.toSorted().join(",")}`
    if (seen.has(key)) {
      return yield* new HarnessError({
        operation: "validate expectation",
        path: "compatibility/expectations.json",
        cause: `duplicate expectation ${key}`,
      })
    }
    seen.add(key)
    if (entry.reason.trim().length === 0 || entry.issue.trim().length === 0) {
      return yield* new HarnessError({
        operation: "validate expectation",
        path: "compatibility/expectations.json",
        cause: `expectation ${key} requires a reason and issue`,
      })
    }
  }
  return expectations
})
