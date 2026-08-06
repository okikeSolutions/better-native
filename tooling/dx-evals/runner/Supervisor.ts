import * as Deferred from "effect/Deferred"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Match from "effect/Match"
import * as Worker from "effect/unstable/workers/Worker"
import type { WorkerError } from "effect/unstable/workers/WorkerError"
import type * as Schema from "effect/Schema"
import { decodeWorkerResponse, type SupervisorRequest, type WorkerResponse } from "./Protocol.ts"

class WorkerProtocolInvalid extends Data.TaggedError("WorkerProtocolInvalid")<{
  readonly reason: string
  readonly cause?: unknown
}> {}

/**
 * Exchanges one request with a task worker through Effect's Worker protocol. The nonce is minted
 * by the outer isolation controller, so candidate stdout cannot impersonate the accepted envelope.
 */
export const supervise = (
  request: SupervisorRequest,
): Effect.Effect<
  Schema.Json,
  WorkerError | WorkerProtocolInvalid,
  Worker.WorkerPlatform | Worker.Spawner
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const platform = yield* Worker.WorkerPlatform
      const worker = yield* platform.spawn<WorkerResponse, SupervisorRequest>(0)
      const response = yield* Deferred.make<WorkerResponse>()
      yield* worker.send(request)
      const runnerFiber = yield* Effect.forkScoped(
        worker.run((message) => Deferred.succeed(response, message)),
      )
      const message = yield* Deferred.await(response).pipe(
        Effect.raceFirst(Fiber.join(runnerFiber)),
      )
      const decoded = yield* Effect.try({
        try: () => decodeWorkerResponse(message),
        catch: (cause) =>
          new WorkerProtocolInvalid({ reason: "invalid-effect-worker-response", cause }),
      })
      if (decoded.nonce !== request.nonce) {
        return yield* new WorkerProtocolInvalid({ reason: "invalid-observation-nonce" })
      }
      return yield* Match.value(decoded).pipe(
        Match.when({ type: "observation" }, ({ observation }) => Effect.succeed(observation)),
        Match.when({ type: "error" }, ({ reason }) =>
          Effect.fail(new WorkerProtocolInvalid({ reason })),
        ),
        Match.exhaustive,
      )
    }),
  )
