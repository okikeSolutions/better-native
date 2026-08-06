import * as Schema from "effect/Schema"
import * as Effect from "effect/Effect"
import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"

/** Public type-level contract which the isolated compiler may enforce for an exported Effect. */
const PublicExportName = Schema.String.check(Schema.isPattern(/^[A-Za-z_$][A-Za-z0-9_$]*$/))
export const PublicCompileContract = Schema.Struct({
  kind: Schema.Literal("effect-no-requirements"),
  exportName: PublicExportName,
})
export type PublicCompileContract = Schema.Schema.Type<typeof PublicCompileContract>

/** Request delivered over stdin so candidate code cannot recover grader inputs from argv. */
export const SupervisorRequest = Schema.Struct({
  nonce: Schema.NonEmptyString,
  entrypoint: Schema.NonEmptyString,
  exportName: Schema.NonEmptyString,
  runnerArguments: Schema.Array(Schema.String),
  publicCompileContract: Schema.optional(PublicCompileContract),
})
export type SupervisorRequest = Schema.Schema.Type<typeof SupervisorRequest>

const WorkerObservationResponse = Schema.Struct({
  type: Schema.Literal("observation"),
  nonce: Schema.NonEmptyString,
  observation: Schema.Json,
})

const WorkerErrorResponse = Schema.Struct({
  type: Schema.Literal("error"),
  nonce: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
})

/** Exactly one terminal response returned over Effect's Worker/WorkerRunner protocol. */
export const WorkerResponse = Schema.Union([WorkerObservationResponse, WorkerErrorResponse])
export type WorkerResponse = Schema.Schema.Type<typeof WorkerResponse>

export const decodeSupervisorRequest = Schema.decodeUnknownSync(SupervisorRequest)
export const decodeWorkerResponse = Schema.decodeUnknownSync(WorkerResponse)

export const readStdinJson = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  const encoded = yield* Stream.mkString(stdio.stdin.pipe(Stream.decodeText()))
  return yield* Effect.try(() => JSON.parse(encoded) as unknown).pipe(Effect.orDie)
})
