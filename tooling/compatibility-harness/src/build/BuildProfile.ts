import type { ProcessSpec } from "../supervision/ProcessSupervisor.ts"

/** Host build policy selected at the harness configuration boundary. */
export type BuildProfile = "polite" | "performance"

/** Native or JavaScript tool whose local resource use is controlled by the build profile. */
export type ProfiledBuildTool = "cocoapods" | "gradle" | "metro" | "metro-wrapper" | "xcode"

/** Android ABI override for the selected profile, or null for generated multi-ABI defaults. */
export const androidArchitecturesFor = (profile: BuildProfile): string | null =>
  profile === "polite" ? "arm64-v8a" : null

const withoutOption = (args: ReadonlyArray<string>, option: string): Array<string> => {
  const result: Array<string> = []
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!
    if (value === option) {
      index += 1
      continue
    }
    if (value.startsWith(`${option}=`)) continue
    result.push(value)
  }
  return result
}

/** Applies the local polite worker and scheduling policy to one process specification. */
export const applyBuildProfile = (
  profile: BuildProfile,
  tool: ProfiledBuildTool,
  spec: ProcessSpec,
): ProcessSpec => {
  if (profile === "performance") return spec
  const original = spec.args ?? []
  let args: Array<string>
  if (tool === "gradle") {
    args = [
      ...withoutOption(
        withoutOption(withoutOption(original, "--max-workers"), "--priority"),
        "-PreactNativeArchitectures",
      ),
      "--max-workers=2",
      "--priority=low",
      `-PreactNativeArchitectures=${androidArchitecturesFor(profile)}`,
    ]
  } else if (tool === "xcode") {
    args = ["-jobs", "2", ...withoutOption(original, "-jobs")]
  } else if (tool === "metro") {
    args = [...withoutOption(original, "--max-workers"), "--max-workers", "2"]
  } else {
    args = [...original]
  }
  return { ...spec, args, darwinScheduling: "utility-background" }
}

/** Environment consumed by Metro config when a wrapper owns the export command. */
export const buildProfileEnvironment = (
  profile: BuildProfile,
): Readonly<Record<string, string | undefined>> => ({
  BETTER_NATIVE_METRO_MAX_WORKERS: profile === "polite" ? "2" : undefined,
})
