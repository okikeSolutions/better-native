import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import type { Platform, ProcessObservation, RunId } from "../Domain.ts"
import { HarnessConfig } from "../HarnessConfig.ts"
import { ProcessSupervisor, type ProcessResult, type ProcessSpec } from "./ProcessSupervisor.ts"

/** Native simulator, emulator, or physical device selected for compatibility execution. */
export interface NativeDevice {
  readonly platform: "ios" | "android"
  readonly id: string
  readonly applicationId: string
  readonly kind?: "simulator" | "emulator" | "physical"
}

/** Failure raised by device installation, liveness, logging, or result collection. */
export class PlatformDriverError extends Data.TaggedError("PlatformDriverError")<{
  readonly operation: "install" | "maestro" | "liveness" | "logs" | "result"
  readonly device: NativeDevice
  readonly cause: unknown
}> {}

/** Platform operations required by the native supervisor. */
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
  readonly result: (
    device: NativeDevice,
    runId: RunId,
  ) => Effect.Effect<string | null, PlatformDriverError>
}

/** Effect context tag for simulator, emulator, and physical-device drivers. */
export class PlatformDrivers extends Context.Service<PlatformDrivers, Service>()(
  "@better-native/compatibility-harness/PlatformDrivers",
) {}

type Requirements = ProcessSupervisor | FileSystem.FileSystem | HarnessConfig

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

const isPhysicalIos = (device: NativeDevice): boolean =>
  device.platform === "ios" && device.kind === "physical"

const physicalIosCommand = (args: ReadonlyArray<string>, timeoutMillis = 60_000): ProcessSpec => ({
  command: "xcrun",
  args: ["devicectl", ...args],
  timeoutMillis,
})

const output = (result: ProcessResult) => result.observations.map(({ text }) => text).join("\n")

/** Predicate restricting iOS log collection to harness and fatal application messages. */
export const iosLogPredicate =
  'eventMessage CONTAINS "BETTER_NATIVE_" OR subsystem == "com.facebook.react.log" OR (process == "BetterNativeCompatibility" AND (messageType == "Error" OR messageType == "Fault"))'

const resultTestId = "compatibility_run_result_json"
const resultChunkMarker = "BETTER_NATIVE_RESULT_V1_CHUNK="
const maximumResultLogBytes = 16 * 1024 * 1024

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

/**
 * Extracts a completed run result from simulator hierarchy output.
 *
 * @remarks
 * The hierarchy is diagnostic transport, not a trusted result by itself; the
 * caller still decodes and validates the embedded run protocol.
 *
 * @param stdout - Raw hierarchy output captured from the platform driver.
 * @returns The encoded result payload, or `null` when no result node exists.
 */
export const resultFromHierarchy = (stdout: string): string | null => {
  const jsonStart = stdout.indexOf("{")
  if (jsonStart < 0) return null
  try {
    return hierarchyResult(JSON.parse(stdout.slice(jsonStart)))
  } catch {
    return null
  }
}

const matchingResult = (json: string | null, runId: RunId): string | null => {
  if (json === null) return null
  try {
    const value: unknown = JSON.parse(json)
    return isRecord(value) && value.runId === runId ? json : null
  } catch {
    return null
  }
}

/**
 * Reassembles a chunked result payload emitted through native logs.
 *
 * @remarks
 * Chunks are accepted only when they identify the requested run and form a
 * contiguous sequence. This prevents stale or interleaved logs becoming run evidence.
 *
 * @param stdout - Raw native log output.
 * @param runId - Run whose payload is being collected.
 * @returns The reassembled payload, or `null` for incomplete chunks.
 */
export const resultFromLogChunks = (stdout: string, runId: RunId): string | null => {
  const chunks = new Map<number, string>()
  let total: number | undefined
  for (const line of stdout.split("\n")) {
    const markerOffset = line.indexOf(resultChunkMarker)
    if (markerOffset < 0) continue
    const encoded = line.slice(markerOffset + resultChunkMarker.length)
    const header = /^([A-Za-z0-9][A-Za-z0-9._-]*):(\d+)\/(\d+):(\d+):/.exec(encoded)
    if (header === null || header[1] !== runId) continue
    const index = Number(header[2])
    const chunkTotal = Number(header[3])
    const length = Number(header[4])
    if (
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(chunkTotal) ||
      !Number.isSafeInteger(length) ||
      index < 0 ||
      chunkTotal < 1 ||
      index >= chunkTotal ||
      length < 0 ||
      (total !== undefined && total !== chunkTotal)
    ) {
      continue
    }
    const chunk = encoded.slice(header[0].length, header[0].length + length)
    if (chunk.length !== length) continue
    total = chunkTotal
    chunks.set(index, chunk)
  }
  if (total === undefined || chunks.size !== total) return null
  const result = Array.from({ length: total }, (_, index) => chunks.get(index))
  return result.every((chunk): chunk is string => chunk !== undefined) ? result.join("") : null
}

/**
 * Checks whether a Maestro JUnit report records a completed passing flow.
 *
 * @param report - Raw JUnit XML written by Maestro.
 * @returns Whether a suite exists without failure or error entries.
 */
export const maestroJUnitPassed = (report: string): boolean =>
  /<testsuites?\b/.test(report) &&
  !/<(?:failure|error)\b/.test(report) &&
  !/\b(?:failures|errors)="[1-9]\d*"/.test(report)

/**
 * Builds native platform drivers from process supervision and filesystem access.
 *
 * @returns A layer providing device installation, execution, liveness, logs, and results.
 */
export const layer: Layer.Layer<PlatformDrivers, never, Requirements> = Layer.effect(
  PlatformDrivers,
  Effect.gen(function* () {
    const processes = yield* ProcessSupervisor
    const fs = yield* FileSystem.FileSystem
    const config = yield* HarnessConfig
    const maestroEnv =
      config.javaHome17 === null
        ? undefined
        : {
            JAVA_HOME: config.javaHome17,
            PATH: `${config.javaHome17}/bin:${config.executablePath}`,
          }
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
          processes
            .run(
              isPhysicalIos(device)
                ? physicalIosCommand(["device", "info", "processes", "--device", device.id], 15_000)
                : command(device, ["spawn", device.id, "launchctl", "list"], 15_000),
            )
            .pipe(
              Effect.map(
                (result) =>
                  result.exitCode === 0 &&
                  output(result).includes(
                    isPhysicalIos(device) ? "BetterNativeCompatibility" : device.applicationId,
                  ),
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
          isPhysicalIos(device)
            ? processes
                .run(
                  physicalIosCommand(
                    ["device", "info", "processes", "--device", device.id],
                    15_000,
                  ),
                )
                .pipe(
                  Effect.map(({ observations }) => observations),
                  Effect.mapError(
                    (cause) => new PlatformDriverError({ operation: "logs", device, cause }),
                  ),
                )
            : invoke("logs", device, [
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
    const result: Service["result"] = (device, runId) =>
      Effect.gen(function* () {
        if (isPhysicalIos(device)) {
          const temporary = yield* fs.makeTempDirectory({ prefix: "better-native-device-result-" })
          const localResult = `${temporary}/result.json`
          const remoteResult = `Documents/better-native-result-${Buffer.from(runId).toString("base64url")}.json`
          return yield* Effect.gen(function* () {
            const copied = yield* processes.run(
              physicalIosCommand(
                [
                  "device",
                  "copy",
                  "from",
                  "--device",
                  device.id,
                  "--domain-type",
                  "appDataContainer",
                  "--domain-identifier",
                  device.applicationId,
                  "--source",
                  remoteResult,
                  "--destination",
                  localResult,
                ],
                30_000,
              ),
            )
            return copied.exitCode === 0 && (yield* fs.exists(localResult))
              ? yield* fs.readFileString(localResult)
              : null
          }).pipe(Effect.ensuring(fs.remove(temporary, { recursive: true }).pipe(Effect.ignore)))
        }
        if (device.platform === "ios" && !isPhysicalIos(device)) {
          const container = yield* processes.run(
            command(device, ["get_app_container", device.id, device.applicationId, "data"], 30_000),
          )
          if (container.exitCode === 0) {
            const dataDirectory = output(container).trim()
            const resultPath = `${dataDirectory}/Documents/better-native-result-${Buffer.from(runId).toString("base64url")}.json`
            if (yield* fs.exists(resultPath)) return yield* fs.readFileString(resultPath)
          }
        }
        const logSpec = Match.value(device.platform).pipe(
          Match.when("android", () =>
            command(device, ["logcat", "-d", "-v", "raw", "ReactNativeJS:V", "*:S"], 30_000),
          ),
          Match.when("ios", () =>
            isPhysicalIos(device)
              ? null
              : command(
                  device,
                  [
                    "spawn",
                    device.id,
                    "log",
                    "show",
                    "--last",
                    "5m",
                    "--style",
                    "compact",
                    "--predicate",
                    `eventMessage CONTAINS "${resultChunkMarker}"`,
                  ],
                  30_000,
                ),
          ),
          Match.exhaustive,
        )
        if (logSpec !== null) {
          const logResult = yield* processes.run({
            ...logSpec,
            retainedOutputBytes: maximumResultLogBytes,
          })
          if (logResult.exitCode === 0) {
            const logged = matchingResult(resultFromLogChunks(output(logResult), runId), runId)
            if (logged !== null) return logged
          }
        }
        const hierarchyProcess = yield* processes.run({
          command: "maestro",
          args: ["--device", device.id, "hierarchy"],
          timeoutMillis: 30_000,
          retainedOutputBytes: maximumResultLogBytes,
          ...(maestroEnv === undefined ? {} : { env: maestroEnv }),
        })
        if (hierarchyProcess.exitCode !== 0) {
          return yield* new PlatformDriverError({
            operation: "result",
            device,
            cause: `maestro hierarchy exited ${hierarchyProcess.exitCode}: ${output(hierarchyProcess)}`,
          })
        }
        return matchingResult(resultFromHierarchy(output(hierarchyProcess)), runId)
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof PlatformDriverError
            ? cause
            : new PlatformDriverError({ operation: "result", device, cause }),
        ),
      )
    return PlatformDrivers.of({
      install: (device, binary) => {
        if (isPhysicalIos(device)) {
          return Effect.gen(function* () {
            // Each upstream/candidate cohort starts from the same empty app container.
            yield* processes.run(
              physicalIosCommand([
                "device",
                "uninstall",
                "app",
                "--device",
                device.id,
                device.applicationId,
              ]),
            )
            return yield* processes.run(
              physicalIosCommand(["device", "install", "app", "--device", device.id, binary]),
            )
          }).pipe(
            Effect.flatMap((installResult) =>
              installResult.exitCode === 0
                ? Effect.void
                : Effect.fail(
                    new PlatformDriverError({
                      operation: "install",
                      device,
                      cause: `command exited ${installResult.exitCode}: ${output(installResult)}`,
                    }),
                  ),
            ),
            Effect.mapError((cause) =>
              cause instanceof PlatformDriverError
                ? cause
                : new PlatformDriverError({ operation: "install", device, cause }),
            ),
          )
        }
        const args = Match.value(device.platform).pipe(
          Match.when("ios", () => ["install", device.id, binary]),
          Match.when("android", () => ["install", "-r", "-t", binary]),
          Match.exhaustive,
        )
        return invoke("install", device, args).pipe(Effect.asVoid)
      },
      runMaestroFlow: (device, flowPath, timeoutMillis) => {
        if (isPhysicalIos(device)) {
          return Effect.gen(function* () {
            const flow = yield* fs.readFileString(flowPath)
            const encodedLink = flow
              .split("\n")
              .find((line) => line.startsWith("- openLink: "))
              ?.slice("- openLink: ".length)
            const link = yield* Effect.try({
              try: () => {
                if (encodedLink === undefined) throw new Error("physical flow has no openLink")
                const decoded: unknown = JSON.parse(encodedLink)
                if (typeof decoded !== "string") {
                  throw new Error("physical flow openLink is not a string")
                }
                return decoded
              },
              catch: (cause) => new PlatformDriverError({ operation: "maestro", device, cause }),
            })
            const launched = yield* processes.run(
              physicalIosCommand(
                [
                  "device",
                  "process",
                  "launch",
                  "--device",
                  device.id,
                  "--terminate-existing",
                  "--payload-url",
                  link,
                  device.applicationId,
                ],
                timeoutMillis,
              ),
            )
            if (launched.exitCode !== 0) {
              return yield* new PlatformDriverError({
                operation: "maestro",
                device,
                cause: `CoreDevice launch exited ${launched.exitCode}: ${output(launched)}`,
              })
            }
            return launched.observations
          }).pipe(
            Effect.mapError((cause) =>
              cause instanceof PlatformDriverError
                ? cause
                : new PlatformDriverError({ operation: "maestro", device, cause }),
            ),
          )
        }
        if (config.javaHome17 === null || maestroEnv === undefined) {
          return Effect.fail(
            new PlatformDriverError({
              operation: "maestro",
              device,
              cause: "Maestro requires JDK 17; install it or set BETTER_NATIVE_JAVA_HOME_17",
            }),
          )
        }
        const reportPath = `${flowPath}.junit.xml`
        return Effect.scoped(
          Effect.gen(function* () {
            const javaVersion = yield* processes.run({
              command: `${config.javaHome17}/bin/java`,
              args: ["-version"],
              timeoutMillis: 30_000,
              env: maestroEnv,
            })
            if (javaVersion.exitCode !== 0) {
              return yield* new PlatformDriverError({
                operation: "maestro",
                device,
                cause: `JDK 17 verification exited ${javaVersion.exitCode}: ${output(javaVersion)}`,
              })
            }
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
              ...(maestroEnv === undefined ? {} : { env: maestroEnv }),
            })
            yield* Effect.addFinalizer(() => running.terminate.pipe(Effect.ignore))
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
            if (exitCode === 0) return [...javaVersion.observations, ...observations]
            const report = (yield* fs.exists(reportPath))
              ? yield* fs.readFileString(reportPath)
              : null
            if (report !== null && maestroJUnitPassed(report)) {
              yield* Effect.logWarning(
                "Maestro wrote a passing JUnit report but did not exit cleanly; accepting the completed flow",
              )
              return [...javaVersion.observations, ...observations]
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

/** Native platforms implemented by the current platform-driver service. */
export const supportedPlatforms: ReadonlyArray<Platform> = ["ios", "android"]
