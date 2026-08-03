import type { Json } from "effect/Schema"
import type { ResolutionBranch } from "../Domain.ts"

const isRecord = (value: Json): value is { readonly [key: string]: Json } =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const platforms = (conditions: ReadonlyArray<string>): ReadonlyArray<string> => {
  if (conditions.some((condition) => condition === "browser")) return ["web"]
  if (conditions.some((condition) => condition === "react-native")) {
    return ["android", "ios", "macos", "tvos"]
  }
  if (conditions.some((condition) => /^(?:node|react-server|workerd)$/.test(condition))) {
    return ["server"]
  }
  return ["android", "ios", "macos", "server", "tvos", "web"]
}

const visit = (
  value: Json,
  conditions: ReadonlyArray<string>,
  fallback: ReadonlyArray<number>,
): ReadonlyArray<ResolutionBranch> => {
  if (typeof value === "string" || value === null) {
    return [{ conditions, fallback, target: value, platforms: platforms(conditions) }]
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => visit(entry, conditions, [...fallback, index]))
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([condition, entry]) =>
      visit(entry, [...conditions, condition], fallback),
    )
  }
  return []
}

export const branches = (value: Json): ReadonlyArray<ResolutionBranch> => visit(value, [], [])
