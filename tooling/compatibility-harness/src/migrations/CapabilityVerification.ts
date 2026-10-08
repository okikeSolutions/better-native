export type VerificationProfile = "host" | "integration" | "promotion"

export interface CapabilityVerificationOptions {
  readonly capabilityId: string
  readonly profile: VerificationProfile
}

export type CapabilityVerificationParseResult =
  | { readonly ok: true; readonly options: CapabilityVerificationOptions }
  | { readonly ok: false; readonly message: string }

export const usage =
  "Usage: bun run verify:capability <capability-id> [--profile host|integration|promotion]"

/** Parses the small public interface of the capability verification command. */
export const parseCapabilityVerificationOptions = (
  args: ReadonlyArray<string>,
): CapabilityVerificationParseResult => {
  let capabilityId: string | undefined
  let profile: VerificationProfile = "host"
  let profileSeen = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--profile" || argument?.startsWith("--profile=") === true) {
      if (profileSeen)
        return { ok: false, message: `--profile may be specified only once.\n${usage}` }
      profileSeen = true
      const value =
        argument === "--profile" ? args[(index += 1)] : argument.slice("--profile=".length)
      if (value !== "host" && value !== "integration" && value !== "promotion") {
        return {
          ok: false,
          message: `Unsupported verification profile ${JSON.stringify(value)}. Available profiles: host, integration, promotion.`,
        }
      }
      profile = value
      continue
    }
    if (argument?.startsWith("--") === true) {
      return { ok: false, message: `Unknown option ${JSON.stringify(argument)}.\n${usage}` }
    }
    if (argument === undefined || argument.length === 0 || capabilityId !== undefined) {
      return { ok: false, message: usage }
    }
    capabilityId = argument
  }

  return capabilityId === undefined
    ? { ok: false, message: usage }
    : { ok: true, options: { capabilityId, profile } }
}
