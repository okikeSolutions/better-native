import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as References from "effect/References"
import * as Schema from "effect/Schema"
import * as AiError from "effect/unstable/ai/AiError"
import * as Domain from "../Domain.ts"
import * as ArtifactStore from "../evidence/ArtifactStore.ts"

export const diagnosticsFileName = "diagnostics.jsonl"
export const maximumProviderResponseBodyBytes = 64 * 1_024

const privateVisibility = "private-diagnostic"

/** Failure raised when the private diagnostic sink cannot be opened safely. */
export class DiagnosticSinkInvalid extends Data.TaggedError("DiagnosticSinkInvalid")<{
  readonly reason: string
}> {}

export interface Service {
  readonly filePath?: string
  readonly recordProviderFailure: (error: AiError.AiError) => Effect.Effect<void>
}

/** Process-scoped private diagnostic sink selected by the live campaign run identity. */
export class Diagnostics extends Context.Service<Diagnostics, Service>()(
  "@better-native/dx-evals/Diagnostics",
) {}

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength

const boundedUtf8 = (value: string) => {
  const originalBytes = utf8Bytes(value)
  if (originalBytes <= maximumProviderResponseBodyBytes) {
    return {
      content: value,
      originalBytes,
      retainedBytes: originalBytes,
      truncated: false,
    }
  }

  let low = 0
  let high = value.length
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2)
    if (utf8Bytes(value.slice(0, midpoint)) <= maximumProviderResponseBodyBytes) {
      low = midpoint
    } else {
      high = midpoint - 1
    }
  }
  const content = value.slice(0, low)
  return {
    content,
    originalBytes,
    retainedBytes: utf8Bytes(content),
    truncated: true,
  }
}

const responseHeaderAllowlist = new Set([
  "cf-ray",
  "content-type",
  "date",
  "retry-after",
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens",
  "x-request-id",
])

const selectedResponseHeaders = (headers: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => responseHeaderAllowlist.has(name.toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right)),
  )

/** Complete private provider diagnostics, excluding credentials, prompts, tools, and submissions. */
export const providerFailureAnnotations = (
  error: AiError.AiError,
): Readonly<Record<string, unknown>> => {
  const reason = error.reason
  const http = "http" in reason ? reason.http : undefined
  const description = "description" in reason ? reason.description : undefined
  const metadata = "metadata" in reason ? reason.metadata : undefined
  return {
    diagnosticVisibility: privateVisibility,
    diagnosticKind: "provider-failure",
    aiModule: error.module,
    aiMethod: error.method,
    providerErrorType: reason._tag,
    providerRetryable: error.isRetryable,
    ...(description === undefined ? {} : { providerDescription: description }),
    ...(metadata === undefined ? {} : { providerMetadata: metadata }),
    ...(http === undefined
      ? {}
      : {
          providerHttpRequest: {
            method: http.request.method,
            url: http.request.url,
            ...(http.request.hash === undefined ? {} : { hash: http.request.hash }),
          },
          ...(http.response === undefined
            ? {}
            : {
                providerHttpResponse: {
                  status: http.response.status,
                  headers: selectedResponseHeaders(http.response.headers),
                },
              }),
          ...(http.body === undefined ? {} : { providerResponseBody: boundedUtf8(http.body) }),
        }),
  }
}

const isPrivate = (options: Logger.Options<unknown>): boolean =>
  options.fiber.getRef(References.CurrentLogAnnotations).diagnosticVisibility === privateVisibility

const publicOnly = (logger: Logger.Logger<unknown, unknown>) =>
  Logger.make<unknown, unknown>((options) =>
    Match.value(isPrivate(options)).pipe(
      Match.when(true, () => undefined),
      Match.when(false, () => logger.log(options)),
      Match.exhaustive,
    ),
  )

const disabledService = Diagnostics.of({
  recordProviderFailure: () => Effect.void,
})

/** No-op diagnostics used by deterministic commands and tests without a campaign run ID. */
export const disabledLayer = Layer.succeed(Diagnostics, disabledService)

const validateFileEntry = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    if (Option.isSome(yield* Effect.option(fs.readLink(filePath)))) {
      return yield* new DiagnosticSinkInvalid({
        reason: "diagnostic-file-must-not-be-a-symbolic-link",
      })
    }
    if (yield* fs.exists(filePath)) {
      const info = yield* fs.stat(filePath)
      if (info.type !== "File") {
        return yield* new DiagnosticSinkInvalid({
          reason: "diagnostic-path-must-be-a-file",
        })
      }
    }
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof DiagnosticSinkInvalid
        ? cause
        : new DiagnosticSinkInvalid({
            reason: `diagnostic-file-validation-failed:${String(cause)}`,
          }),
    ),
  )

/** Native Effect JSONL logger for one validated campaign artifact directory. */
export const layerForCampaign = (runId: Domain.RunId) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const path = yield* Path.Path
      const directory = yield* ArtifactStore.ensureDirectory(runId)
      const filePath = path.join(directory, diagnosticsFileName)
      yield* validateFileEntry(filePath)

      const fileLogger = Logger.formatJson.pipe(
        Logger.toFile(filePath, {
          flag: "a+",
          mode: 0o600,
          batchWindow: 50,
        }),
      )
      const loggerLayer = Logger.layer([
        publicOnly(Logger.defaultLogger),
        publicOnly(Logger.tracerLogger),
        fileLogger,
      ])
      const serviceLayer = Layer.succeed(
        Diagnostics,
        Diagnostics.of({
          filePath,
          recordProviderFailure: (error) =>
            Effect.logError("Provider request failed").pipe(
              Effect.annotateLogs(providerFailureAnnotations(error)),
            ),
        }),
      )
      return Layer.merge(loggerLayer, serviceLayer)
    }),
  )

const campaignRunId = Config.option(Config.string("BETTER_NATIVE_EVAL_RUN_ID"))

/** Enables private campaign diagnostics only when the controller supplies a run identity. */
export const layer = Layer.unwrap(
  campaignRunId.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(disabledLayer),
        onSome: (untrusted) =>
          Schema.decodeUnknownEffect(Domain.RunId)(untrusted).pipe(
            Effect.map((runId) => layerForCampaign(runId)),
          ),
      }),
    ),
  ),
)
