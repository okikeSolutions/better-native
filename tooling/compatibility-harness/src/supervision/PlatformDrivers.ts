import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import type { Platform, ProcessObservation } from "../Domain.ts"
import { ProcessSupervisor, type ProcessResult, type ProcessSpec } from "./ProcessSupervisor.ts"

export interface NativeDevice {
  readonly platform: "ios" | "android"
  readonly id: string
  readonly applicationId: string
}

export class PlatformDriverError extends Data.TaggedError("PlatformDriverError")<{
  readonly operation: "install" | "maestro" | "liveness" | "logs" | "result"
  readonly device: NativeDevice
  readonly cause: unknown
}> {}

export interface Service {
  readonly install: (
    device: NativeDevice,
    binary: string,
  ) => Effect.Effect<void, PlatformDriverError>
  readonly runMaestroFlow: (
    device: NativeDevice,
    flowPath: string,
    timeoutMillis: number,
  ) => Effect.Effect<ReadonlyArray<ProcessObservation>, PlatformDriverError>
  readonly isAlive: (device: NativeDevice) => Effect.Effect<boolean, PlatformDriverError>
  readonly logs: (
    device: NativeDevice,
  ) => Effect.Effect<ReadonlyArray<ProcessObservation>, PlatformDriverError>
  readonly result: (device: NativeDevice) => Effect.Effect<string | null, PlatformDriverError>
}

export class PlatformDrivers extends Context.Service<PlatformDrivers, Service>()(
  "@better-native/compatibility-harness/PlatformDrivers",
) {}

type Requirements = ProcessSupervisor | FileSystem.FileSystem

const command = (
  device: NativeDevice,
  args: ReadonlyArray<string>,
  timeoutMillis = 60_000,
): ProcessSpec =>
  Match.value(device.platform).pipe(
    Match.when("ios", () => ({ command: "xcrun", args: ["simctl", ...args], timeoutMillis })),
    Match.when("android", () => ({
      command: "adb",
      args: ["-s", device.id, ...args],
      timeoutMillis,
    })),
    Match.exhaustive,
  )

const output = (result: ProcessResult) => result.observations.map(({ text }) => text).join("\n")

export const iosLogPredicate =
  'eventMessage CONTAINS "BETTER_NATIVE_" OR subsystem == "com.facebook.react.log" OR (process == "BetterNativeCompatibility" AND (messageType == "Error" OR messageType == "Fault"))'

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

export const maestroJUnitPassed = (report: string): boolean =>
  /<testsuites?\b/.test(report) &&
  !/<(?:failure|error)\b/.test(report) &&
  !/\b(?:failures|errors)="[1-9]\d*"/.test(report)

export const layer: Layer.Layer<PlatformDrivers, never, Requirements> = Layer.effect(
  PlatformDrivers,
  Effect.gen(function* () {
    const processes = yield* ProcessSupervisor
    const fs = yield* FileSystem.FileSystem
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
    const isAlive: Service["isAlive"] = (device) =>
      Match.value(device.platform).pipe(
        Match.when("android", () =>
          processes.run(command(device, ["shell", "pidof", device.applicationId], 15_000)).pipe(
            Effect.map((result) => result.exitCode === 0 && output(result).trim().length > 0),
            Effect.mapError(
              (cause) => new PlatformDriverError({ operation: "liveness", device, cause }),
            ),
          ),
        ),
        Match.when("ios", () =>
          processes.run(command(device, ["spawn", device.id, "launchctl", "list"], 15_000)).pipe(
            Effect.map(
              (result) => result.exitCode === 0 && output(result).includes(device.applicationId),
            ),
            Effect.mapError(
              (cause) => new PlatformDriverError({ operation: "liveness", device, cause }),
            ),
          ),
        ),
        Match.exhaustive,
      )
    const logs: Service["logs"] = (device) => {
      return Match.value(device.platform).pipe(
        Match.when("android", () =>
          invoke("logs", device, [
            "logcat",
            "-d",
            "-v",
            "epoch",
            "ReactNativeJS:V",
            "ReactNative:V",
            "AndroidRuntime:E",
            "ActivityTaskManager:I",
            "Expo:V",
            "*:S",
          ]).pipe(Effect.map(({ observations }) => observations)),
        ),
        Match.when("ios", () =>
          invoke("logs", device, [
            "spawn",
            device.id,
            "log",
            "show",
            "--last",
            "1m",
            "--style",
            "json",
            "--predicate",
            iosLogPredicate,
          ]).pipe(Effect.map(({ observations }) => observations)),
        ),
        Match.exhaustive,
      )
    }
    const result: Service["result"] = (device) =>
      processes
        .run({
          command: "maestro",
          args: ["--device", device.id, "hierarchy"],
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
    return PlatformDrivers.of({
      install: (device, binary) => {
        const args = Match.value(device.platform).pipe(
          Match.when("ios", () => ["install", device.id, binary]),
          Match.when("android", () => ["install", "-r", "-t", binary]),
          Match.exhaustive,
        )
        return invoke("install", device, args).pipe(Effect.asVoid)
      },
      runMaestroFlow: (device, flowPath, timeoutMillis) => {
        const reportPath = `${flowPath}.junit.xml`
        return Effect.scoped(
          Effect.gen(function* () {
            if (yield* fs.exists(reportPath)) yield* fs.remove(reportPath)
            const running = yield* processes.start({
              command: "maestro",
              args: [
                "--device",
                device.id,
                "test",
                "--format",
                "junit",
                "--output",
                reportPath,
                flowPath,
              ],
              timeoutMillis,
              terminationGraceMillis: 5_000,
            })
            yield* Effect.gen(function* () {
              while (!(yield* fs.exists(reportPath))) yield* Effect.sleep(1_000)
              yield* Effect.sleep(60_000)
              yield* running.terminate
            }).pipe(Effect.forkScoped)
            const exitCode = yield* running.exitCode.pipe(
              Effect.timeoutOrElse({
                duration: timeoutMillis,
                orElse: () =>
                  running.terminate.pipe(
                    Effect.andThen(
                      Effect.fail(
                        new PlatformDriverError({
                          operation: "maestro",
                          device,
                          cause: `maestro exceeded ${timeoutMillis}ms without completing`,
                        }),
                      ),
                    ),
                  ),
              }),
            )
            const observations = yield* running.observations
            if (exitCode === 0) return observations
            const report = (yield* fs.exists(reportPath))
              ? yield* fs.readFileString(reportPath)
              : null
            if (report !== null && maestroJUnitPassed(report)) {
              yield* Effect.logWarning(
                "Maestro wrote a passing JUnit report but did not exit cleanly; accepting the completed flow",
              )
              return observations
            }
            return yield* new PlatformDriverError({
              operation: "maestro",
              device,
              cause: `maestro flow exited ${exitCode}: ${observations.map(({ text }) => text).join("\n")}`,
            })
          }),
        ).pipe(
          Effect.mapError((cause) =>
            cause instanceof PlatformDriverError
              ? cause
              : new PlatformDriverError({ operation: "maestro", device, cause }),
          ),
        )
      },
      isAlive,
      logs,
      result,
    })
  }),
)

export const supportedPlatforms: ReadonlyArray<Platform> = ["ios", "android"]
