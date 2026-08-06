import { assert, describe, it } from "@effect/vitest"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as TestConsole from "effect/testing/TestConsole"
import * as AiError from "effect/unstable/ai/AiError"
import * as AppConfig from "../Config.ts"
import * as Domain from "../Domain.ts"
import * as ArtifactStore from "../evidence/ArtifactStore.ts"
import { provideLayer } from "../TestLayers.ts"
import * as Diagnostics from "./Diagnostics.ts"

const providerFailure = (body: string) =>
  AiError.make({
    module: "OpenRouterClient",
    method: "chatCompletions",
    reason: new AiError.InvalidRequestError({
      description: "Provider rejected the request",
      metadata: {
        openrouter: {
          errorCode: 400,
          errorType: "invalid_request_error",
          requestId: "request-123",
        },
      },
      http: {
        request: {
          method: "POST",
          url: "https://openrouter.ai/api/v1/chat/completions",
          urlParams: [],
          headers: { authorization: "<redacted>" },
        },
        response: {
          status: 400,
          headers: {
            "content-type": "application/json",
            "set-cookie": "MUST-NOT-BE-RETAINED",
            "x-request-id": "request-123",
          },
        },
        body,
      },
    }),
  })

describe("private campaign diagnostics", () => {
  it("retains a bounded provider body and selected HTTP metadata", () => {
    const body = `PRIVATE-${"🙂".repeat(20_000)}`
    const annotations = Diagnostics.providerFailureAnnotations(providerFailure(body))
    const responseBody = Schema.decodeUnknownSync(
      Schema.Struct({
        content: Schema.String,
        originalBytes: Schema.Number,
        retainedBytes: Schema.Number,
        truncated: Schema.Boolean,
      }),
    )(annotations.providerResponseBody)

    assert.isTrue(responseBody.truncated)
    assert.isAbove(responseBody.originalBytes, Diagnostics.maximumProviderResponseBodyBytes)
    assert.isAtMost(responseBody.retainedBytes, Diagnostics.maximumProviderResponseBodyBytes)
    assert.strictEqual(
      new TextEncoder().encode(responseBody.content).byteLength,
      responseBody.retainedBytes,
    )
    assert.deepStrictEqual(annotations.providerHttpResponse, {
      status: 400,
      headers: {
        "content-type": "application/json",
        "x-request-id": "request-123",
      },
    })
    assert.notInclude(JSON.stringify(annotations), "MUST-NOT-BE-RETAINED")
    assert.notInclude(JSON.stringify(annotations), "authorization")
  })

  it.effect("writes private JSONL without echoing the response body to the console", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const repositoryRoot = yield* fs.makeTempDirectoryScoped({ prefix: "dx-diagnostics-" })
        const runId = Domain.RunId.make("campaign-diagnostics-test")
        const body = '{"error":{"message":"PRIVATE-PROVIDER-RESPONSE"}}'

        yield* Effect.scoped(
          Effect.gen(function* () {
            const loggerContext = yield* Layer.build(
              Diagnostics.layerForCampaign(runId).pipe(
                Layer.provideMerge(
                  Layer.merge(AppConfig.layer(repositoryRoot), NodeServices.layer),
                ),
              ),
            )
            yield* Effect.gen(function* () {
              const diagnostics = yield* Diagnostics.Diagnostics
              yield* Effect.logInfo("public lifecycle event")
              yield* diagnostics.recordProviderFailure(providerFailure(body))
            }).pipe(Effect.provideContext(loggerContext))
          }),
        )

        const filePath = `${repositoryRoot}/.artifacts/evals/${runId}/${Diagnostics.diagnosticsFileName}`
        const lines = (yield* fs.readFileString(filePath)).trim().split("\n")
        const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
        const rendered = JSON.stringify(records)
        assert.include(rendered, "public lifecycle event")
        assert.include(rendered, "PRIVATE-PROVIDER-RESPONSE")
        assert.include(rendered, '"status":400')

        const consoleOutput = JSON.stringify(yield* TestConsole.logLines)
        assert.include(consoleOutput, "public lifecycle event")
        assert.notInclude(consoleOutput, "PRIVATE-PROVIDER-RESPONSE")
      }),
    ).pipe(provideLayer(NodeServices.layer)),
  )

  it.effect("rejects a diagnostic file redirected through a symbolic link", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const repositoryRoot = yield* fs.makeTempDirectoryScoped({ prefix: "dx-diagnostics-link-" })
        const runId = Domain.RunId.make("campaign-diagnostics-link-test")
        const platform = Layer.merge(AppConfig.layer(repositoryRoot), NodeServices.layer)
        const directory = yield* ArtifactStore.ensureDirectory(runId).pipe(provideLayer(platform))
        const redirected = `${repositoryRoot}/redirected.jsonl`
        yield* fs.writeFileString(redirected, "")
        yield* fs.symlink(redirected, `${directory}/${Diagnostics.diagnosticsFileName}`)

        const result = yield* Effect.exit(
          Layer.build(Diagnostics.layerForCampaign(runId).pipe(Layer.provideMerge(platform))),
        )
        assert.strictEqual(result._tag, "Failure")
      }),
    ).pipe(provideLayer(NodeServices.layer)),
  )
})
