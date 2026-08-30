import * as Effect from "effect/Effect"
import { decodeSupervisorRequest, readStdinJson } from "./Protocol.ts"
import { makeSupervisorRuntime } from "./Runtime.ts"
import { supervise } from "./Supervisor.ts"

const runtime = makeSupervisorRuntime("./worker-clipboard.ts")
try {
  const { observation, request } = await runtime.runPromise(
    Effect.gen(function* () {
      const decodedRequest = decodeSupervisorRequest(yield* readStdinJson)
      return { request: decodedRequest, observation: yield* supervise(decodedRequest) }
    }),
  )
  process.stdout.write(
    `BETTER_NATIVE_OBSERVATION:${request.nonce}:${JSON.stringify(observation)}\n`,
  )
} finally {
  await runtime.dispose()
}
