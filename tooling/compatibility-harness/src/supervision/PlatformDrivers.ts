import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import type { Platform, ProcessObservation } from "../Domain.ts"
import { ProcessSupervisor, type ProcessResult, type ProcessSpec } from "./ProcessSupervisor.ts"

export interface NativeDevice {
  readonly platform: "ios" | "android"
  readonly id: string
  readonly applicationId: string
  readonly activity?: string
}

export interface NativeLaunch {
  readonly alive: boolean
  readonly crashed: boolean
  readonly logs: ReadonlyArray<ProcessObservation>
}

export class PlatformDriverError extends Data.TaggedError("PlatformDriverError")<{
  readonly operation:
    | "install"
    | "reset"
    | "launch"
    | "maestro"
    | "liveness"
    | "logs"
    | "result"
    | "permissions"
    | "cleanup"
  readonly device: NativeDevice
  readonly cause: unknown
}> {}

export interface Service {
  readonly install: (
    device: NativeDevice,
    binary: string,
  ) => Effect.Effect<void, PlatformDriverError>
  readonly reset: (device: NativeDevice) => Effect.Effect<void, PlatformDriverError>
  readonly launch: (device: NativeDevice) => Effect.Effect<NativeLaunch, PlatformDriverError>
  readonly runMaestroFlow: (
    device: NativeDevice,
    flowPath: string,
    timeoutMillis: number,
  ) => Effect.Effect<ReadonlyArray<ProcessObservation>, PlatformDriverError>
  readonly isAlive: (device: NativeDevice) => Effect.Effect<boolean, PlatformDriverError>
  readonly grantPermissions: (device: NativeDevice) => Effect.Effect<void, PlatformDriverError>
  readonly logs: (
    device: NativeDevice,
  ) => Effect.Effect<ReadonlyArray<ProcessObservation>, PlatformDriverError>
  readonly result: (device: NativeDevice) => Effect.Effect<string | null, PlatformDriverError>
  readonly cleanup: (device: NativeDevice) => Effect.Effect<void, PlatformDriverError>
}

export class PlatformDrivers extends Context.Service<PlatformDrivers, Service>()(
  "@better-native/compatibility-harness/PlatformDrivers",
) {}

const command = (
  device: NativeDevice,
  args: ReadonlyArray<string>,
  timeoutMillis = 60_000,
): ProcessSpec =>
  device.platform === "ios"
    ? { command: "xcrun", args: ["simctl", ...args], timeoutMillis }
    : { command: "adb", args: ["-s", device.id, ...args], timeoutMillis }

const output = (result: ProcessResult) => result.observations.map(({ text }) => text).join("\n")

const resultTestId = "compatibility_run_result_json"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const hierarchyResult = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = hierarchyResult(child)
      if (found !== null) return found
    }
    return null
  }
  if (!isRecord(value)) return null
  const attributes = value.attributes
  if (isRecord(attributes)) {
    const resourceId = attributes["resource-id"]
    const accessibilityText = attributes.accessibilityText
    const identifiesResult =
      resourceId === resultTestId ||
      (typeof resourceId === "string" && resourceId.endsWith(`:id/${resultTestId}`)) ||
      accessibilityText === resultTestId
    if (identifiesResult) {
      const text = attributes.text
      if (typeof text === "string" && text.length > 0) return text
      if (typeof accessibilityText === "string" && accessibilityText !== resultTestId) {
        return accessibilityText
      }
    }
  }
  for (const child of Object.values(value)) {
    const found = hierarchyResult(child)
    if (found !== null) return found
  }
  return null
}

export const resultFromHierarchy = (stdout: string): string | null => {
  const jsonStart = stdout.indexOf("{")
  if (jsonStart < 0) return null
  try {
    return hierarchyResult(JSON.parse(stdout.slice(jsonStart)))
  } catch {
    return null
  }
}

const stopArgs = (device: NativeDevice) =>
  device.platform === "ios"
    ? ["terminate", device.id, device.applicationId]
    : ["shell", "am", "force-stop", device.applicationId]

export const layer: Layer.Layer<PlatformDrivers, never, ProcessSupervisor> = Layer.effect(
  PlatformDrivers,
  Effect.gen(function* () {
    const processes = yield* ProcessSupervisor
    const invoke = (
      operation: PlatformDriverError["operation"],
      device: NativeDevice,
      args: ReadonlyArray<string>,
      acceptedExitCodes: ReadonlyArray<number> = [0],
    ) =>
      processes.run(command(device, args)).pipe(
        Effect.flatMap((result) =>
          acceptedExitCodes.includes(result.exitCode)
            ? Effect.succeed(result)
            : Effect.fail(
                new PlatformDriverError({
                  operation,
                  device,
                  cause: `command exited ${result.exitCode}: ${output(result)}`,
                }),
              ),
        ),
        Effect.mapError((cause) =>
          cause instanceof PlatformDriverError
            ? cause
            : new PlatformDriverError({ operation, device, cause }),
        ),
      )
    const isAlive: Service["isAlive"] = (device) => {
      const args =
        device.platform === "ios"
          ? ["spawn", device.id, "launchctl", "list", device.applicationId]
          : ["shell", "pidof", device.applicationId]
      return processes.run(command(device, args, 15_000)).pipe(
        Effect.map((result) => result.exitCode === 0 && output(result).trim().length > 0),
        Effect.mapError(
          (cause) => new PlatformDriverError({ operation: "liveness", device, cause }),
        ),
      )
    }
    const logs: Service["logs"] = (device) => {
      const args =
        device.platform === "ios"
          ? [
              "spawn",
              device.id,
              "log",
              "show",
              "--last",
              "5m",
              "--style",
              "json",
              "--predicate",
              'eventMessage CONTAINS "BETTER_NATIVE_"',
            ]
          : ["logcat", "-d", "-v", "epoch"]
      return invoke("logs", device, args).pipe(Effect.map(({ observations }) => observations))
    }
    const result: Service["result"] = (device) =>
      processes
        .run({
          command: "maestro",
          args: [`--platform=${device.platform}`, "hierarchy"],
          timeoutMillis: 30_000,
        })
        .pipe(
          Effect.flatMap((processResult) =>
            processResult.exitCode === 0
              ? Effect.succeed(resultFromHierarchy(output(processResult)))
              : Effect.fail(
                  new PlatformDriverError({
                    operation: "result",
                    device,
                    cause: `maestro hierarchy exited ${processResult.exitCode}: ${output(processResult)}`,
                  }),
                ),
          ),
          Effect.mapError((cause) =>
            cause instanceof PlatformDriverError
              ? cause
              : new PlatformDriverError({ operation: "result", device, cause }),
          ),
        )
    const service: Service = {
      install: (device, binary) => {
        const args =
          device.platform === "ios"
            ? ["install", device.id, binary]
            : ["install", "-r", "-t", binary]
        return invoke("install", device, args).pipe(Effect.asVoid)
      },
      reset: (device) => {
        const clearArgs =
          device.platform === "ios"
            ? ["uninstall", device.id, device.applicationId]
            : ["shell", "pm", "clear", device.applicationId]
        return invoke("reset", device, stopArgs(device), [0, 3, 4]).pipe(
          Effect.andThen(invoke("reset", device, clearArgs, [0, 1])),
          Effect.asVoid,
        )
      },
      grantPermissions: (device) => {
        if (device.platform === "ios") {
          return invoke("permissions", device, [
            "privacy",
            device.id,
            "grant",
            "all",
            device.applicationId,
          ]).pipe(Effect.asVoid)
        }
        const permissions = [
          "android.permission.ACCESS_COARSE_LOCATION",
          "android.permission.ACCESS_FINE_LOCATION",
          "android.permission.ACCESS_BACKGROUND_LOCATION",
          "android.permission.CAMERA",
          "android.permission.POST_NOTIFICATIONS",
          "android.permission.READ_CALENDAR",
          "android.permission.READ_CONTACTS",
          "android.permission.RECORD_AUDIO",
          "android.permission.WRITE_CALENDAR",
          "android.permission.WRITE_CONTACTS",
        ]
        return Effect.forEach(
          permissions,
          (permission) =>
            invoke(
              "permissions",
              device,
              ["shell", "pm", "grant", device.applicationId, permission],
              [0],
            ),
          { discard: true },
        )
      },
      launch: (device) => {
        const args = Match.value(device.platform).pipe(
          Match.when("ios", () => [
            "launch",
            "--terminate-running-process",
            device.id,
            device.applicationId,
          ]),
          Match.when("android", () => [
            "shell",
            "am",
            "start",
            "-W",
            "-n",
            `${device.applicationId}/${device.activity ?? ".MainActivity"}`,
          ]),
          Match.exhaustive,
        )
        return invoke("launch", device, args).pipe(
          Effect.andThen(Effect.sleep(1_000)),
          Effect.andThen(Effect.all([isAlive(device), logs(device)])),
          Effect.map(([alive, logEntries]) => {
            const logText = logEntries.map((entry) => entry.text).join("\n")
            return {
              alive,
              crashed:
                !alive ||
                /(?:FATAL EXCEPTION|Terminated due to signal|crash report)/i.test(logText),
              logs: logEntries,
            }
          }),
        )
      },
      runMaestroFlow: (device, flowPath, timeoutMillis) =>
        processes
          .run({
            command: "maestro",
            args: ["test", flowPath],
            timeoutMillis,
            terminationGraceMillis: 5_000,
          })
          .pipe(
            Effect.flatMap((flowResult) =>
              flowResult.exitCode === 0
                ? Effect.succeed(flowResult.observations)
                : Effect.fail(
                    new PlatformDriverError({
                      operation: "maestro",
                      device,
                      cause: `maestro flow exited ${flowResult.exitCode}: ${output(flowResult)}`,
                    }),
                  ),
            ),
            Effect.mapError((cause) =>
              cause instanceof PlatformDriverError
                ? cause
                : new PlatformDriverError({ operation: "maestro", device, cause }),
            ),
          ),
      isAlive,
      logs,
      result,
      cleanup: (device) =>
        invoke("cleanup", device, stopArgs(device), [0, 3, 4]).pipe(Effect.asVoid),
    }
    return PlatformDrivers.of(service)
  }),
)

export const supportedPlatforms: ReadonlyArray<Platform> = ["ios", "android"]
