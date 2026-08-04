import { assert, describe, it } from "@effect/vitest"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Deferred from "effect/Deferred"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import {
  layer,
  layerFromBackend,
  ProcessFailure,
  ProcessSupervisor,
  type ProcessBackend,
} from "./ProcessSupervisor.ts"

const spec = { command: "fake", timeoutMillis: 1_000 }
const encoder = new TextEncoder()

class TestProcessError extends Data.TaggedError("TestProcessError")<{
  readonly message: string
}> {}

const testFailure = (message: string) => new TestProcessError({ message })

describe("ProcessSupervisor", () => {
  it.effect("streams stdout and stderr before returning the exit code", () =>
    Effect.gen(function* () {
      const supervisor = yield* ProcessSupervisor
      const result = yield* supervisor.run(spec)
      assert.strictEqual(result.exitCode, 7)
      assert.deepEqual(
        result.observations.map(({ stream, text }) => [stream, text]),
        [
          ["stdout", "out-1"],
          ["stdout", "out-2"],
          ["stderr", "err-1"],
        ],
      )
    }).pipe(Effect.provide(layerFromBackend(backendPlaceholder))),
  )

  it.effect("cleans the detached process group after a successful command", () => {
    let cleanups = 0
    const backend: ProcessBackend = {
      spawn: () =>
        Effect.succeed({
          stdout: Stream.empty,
          stderr: Stream.empty,
          exitCode: Effect.succeed(0),
          terminate: () => Effect.sync(() => cleanups++).pipe(Effect.asVoid),
        }),
    }
    return Effect.gen(function* () {
      const supervisor = yield* ProcessSupervisor
      const result = yield* supervisor.run(spec)
      assert.strictEqual(result.exitCode, 0)
      assert.strictEqual(cleanups, 1)
    }).pipe(Effect.provide(layerFromBackend(backend)))
  })

  it.effect("times out a hung process and requests escalated termination", () =>
    Effect.gen(function* () {
      const exit = yield* Deferred.make<number>()
      const terminated = yield* Ref.make(0)
      const backend: ProcessBackend = {
        spawn: () =>
          Effect.succeed({
            stdout: Stream.empty,
            stderr: Stream.empty,
            exitCode: Deferred.await(exit),
            terminate: () => Ref.update(terminated, (count) => count + 1),
          }),
      }
      const fiber = yield* Effect.gen(function* () {
        const supervisor = yield* ProcessSupervisor
        return yield* supervisor.run(spec)
      }).pipe(Effect.provide(layerFromBackend(backend)), Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust(1_000)
      const failure = yield* Fiber.join(fiber).pipe(Effect.flip)
      assert.instanceOf(failure, ProcessFailure)
      assert.strictEqual(failure.reason, "timeout")
      assert.strictEqual(yield* Ref.get(terminated), 1)
    }),
  )

  it.effect("classifies a missing binary as a spawn failure", () => {
    const backend: ProcessBackend = { spawn: () => Effect.fail(testFailure("ENOENT")) }
    return Effect.gen(function* () {
      const supervisor = yield* ProcessSupervisor
      const failure = yield* supervisor.run(spec).pipe(Effect.flip)
      assert.strictEqual(failure.reason, "spawn")
      assert.match(String(failure.cause), /ENOENT/)
    }).pipe(Effect.provide(layerFromBackend(backend)))
  })

  it.effect("preserves output observed before a stream failure", () => {
    const backend: ProcessBackend = {
      spawn: () =>
        Effect.succeed({
          stdout: Stream.make("before-failure").pipe(
            Stream.concat(Stream.fail(testFailure("stream exploded"))),
          ),
          stderr: Stream.empty,
          exitCode: Effect.succeed(1),
          terminate: () => Effect.void,
        }),
    }
    return Effect.gen(function* () {
      const supervisor = yield* ProcessSupervisor
      const failure = yield* supervisor.run(spec).pipe(Effect.flip)
      assert.strictEqual(failure.reason, "stream")
      assert.deepEqual(
        failure.observations.map(({ stream, text }) => [stream, text]),
        [["stdout", "before-failure"]],
      )
    }).pipe(Effect.provide(layerFromBackend(backend)))
  })

  it.effect("surfaces a started process stream failure through its completion", () => {
    const backend: ProcessBackend = {
      spawn: () =>
        Effect.succeed({
          stdout: Stream.make("before-failure").pipe(
            Stream.concat(Stream.fail(testFailure("started stream exploded"))),
          ),
          stderr: Stream.empty,
          exitCode: Effect.succeed(1),
          terminate: () => Effect.void,
        }),
    }
    return Effect.scoped(
      Effect.gen(function* () {
        const supervisor = yield* ProcessSupervisor
        const running = yield* supervisor.start(spec)
        const failure = yield* running.exitCode.pipe(Effect.flip)
        assert.strictEqual(failure.reason, "stream")
        assert.deepEqual(
          failure.observations.map(({ stream, text }) => [stream, text]),
          [["stdout", "before-failure"]],
        )
      }).pipe(Effect.provide(layerFromBackend(backend))),
    )
  })

  it.effect("drains final output emitted while terminating a started process", () =>
    Effect.gen(function* () {
      const finalOutput = yield* Deferred.make<string>()
      const terminations = yield* Ref.make(0)
      const backend: ProcessBackend = {
        spawn: () =>
          Effect.succeed({
            stdout: Stream.fromEffect(Deferred.await(finalOutput)),
            stderr: Stream.empty,
            exitCode: Effect.never,
            terminate: () =>
              Ref.update(terminations, (count) => count + 1).pipe(
                Effect.andThen(Deferred.succeed(finalOutput, "shutdown-tail")),
                Effect.asVoid,
              ),
          }),
      }
      yield* Effect.scoped(
        Effect.gen(function* () {
          const supervisor = yield* ProcessSupervisor
          const running = yield* supervisor.start(spec)
          yield* running.terminate
          yield* running.terminate
          const observations = yield* running.observations
          assert.strictEqual(yield* Ref.get(terminations), 1)
          assert.deepEqual(
            observations.map(({ stream, text }) => [stream, text]),
            [
              ["supervisor", "termination requested"],
              ["stdout", "shutdown-tail"],
            ],
          )
        }).pipe(Effect.provide(layerFromBackend(backend))),
      )
    }),
  )

  it.effect("drains final output before reporting a timeout", () =>
    Effect.gen(function* () {
      const finalOutput = yield* Deferred.make<string>()
      const backend: ProcessBackend = {
        spawn: () =>
          Effect.succeed({
            stdout: Stream.fromEffect(Deferred.await(finalOutput)),
            stderr: Stream.empty,
            exitCode: Effect.never,
            terminate: () => Deferred.succeed(finalOutput, "timeout-tail").pipe(Effect.asVoid),
          }),
      }
      const fiber = yield* Effect.gen(function* () {
        const supervisor = yield* ProcessSupervisor
        return yield* supervisor.run(spec)
      }).pipe(Effect.provide(layerFromBackend(backend)), Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust(spec.timeoutMillis)
      const failure = yield* Fiber.join(fiber).pipe(Effect.flip)
      assert.strictEqual(failure.reason, "timeout")
      assert.deepEqual(
        failure.observations.map(({ stream, text }) => [stream, text]),
        [
          ["supervisor", `timeout after ${spec.timeoutMillis}ms`],
          ["stdout", "timeout-tail"],
        ],
      )
    }),
  )

  it.effect("waits for delayed output before classifying an exit failure", () =>
    Effect.gen(function* () {
      const finalOutput = yield* Deferred.make<string>()
      const backend: ProcessBackend = {
        spawn: () =>
          Effect.succeed({
            stdout: Stream.fromEffect(Deferred.await(finalOutput)),
            stderr: Stream.empty,
            exitCode: Effect.fail(testFailure("process exited by signal")),
            terminate: () => Effect.void,
          }),
      }
      yield* Effect.scoped(
        Effect.gen(function* () {
          const supervisor = yield* ProcessSupervisor
          const running = yield* supervisor.start(spec)
          const completion = yield* running.exitCode.pipe(Effect.flip, Effect.forkChild)
          yield* Effect.yieldNow
          yield* Deferred.succeed(finalOutput, "tail-after-exit")
          const failure = yield* Fiber.join(completion)
          assert.strictEqual(failure.reason, "exit")
          assert.deepEqual(
            failure.observations.map(({ stream, text }) => [stream, text]),
            [["stdout", "tail-after-exit"]],
          )
        }).pipe(Effect.provide(layerFromBackend(backend))),
      )
    }),
  )

  it.effect("waits for the other stream after one stream fails", () =>
    Effect.gen(function* () {
      const stderrTail = yield* Deferred.make<string>()
      const backend: ProcessBackend = {
        spawn: () =>
          Effect.succeed({
            stdout: Stream.fail(testFailure("stdout exploded")),
            stderr: Stream.fromEffect(Deferred.await(stderrTail)),
            exitCode: Effect.succeed(1),
            terminate: () => Effect.void,
          }),
      }
      yield* Effect.scoped(
        Effect.gen(function* () {
          const supervisor = yield* ProcessSupervisor
          const running = yield* supervisor.start(spec)
          const completion = yield* running.exitCode.pipe(Effect.flip, Effect.forkChild)
          yield* Effect.yieldNow
          yield* Deferred.succeed(stderrTail, "stderr-tail")
          const failure = yield* Fiber.join(completion)
          assert.strictEqual(failure.reason, "stream")
          assert.deepEqual(
            failure.observations.map(({ stream, text }) => [stream, text]),
            [["stderr", "stderr-tail"]],
          )
        }).pipe(Effect.provide(layerFromBackend(backend))),
      )
    }),
  )

  it.effect("preserves termination and stream failures after draining final output", () =>
    Effect.gen(function* () {
      const finalOutput = yield* Deferred.make<string>()
      const backend: ProcessBackend = {
        spawn: () =>
          Effect.succeed({
            stdout: Stream.fromEffect(Deferred.await(finalOutput)).pipe(
              Stream.concat(Stream.fail(testFailure("stream cleanup failed"))),
            ),
            stderr: Stream.empty,
            exitCode: Effect.never,
            terminate: () => Effect.fail(testFailure("termination exploded")),
          }),
      }
      yield* Effect.scoped(
        Effect.gen(function* () {
          const supervisor = yield* ProcessSupervisor
          const running = yield* supervisor.start(spec)
          const termination = yield* running.terminate.pipe(Effect.flip, Effect.forkChild)
          yield* Effect.yieldNow
          yield* Deferred.succeed(finalOutput, "termination-tail")
          const failure = yield* Fiber.join(termination)
          assert.strictEqual(failure.reason, "exit")
          assert.deepEqual(
            failure.observations.map(({ stream, text }) => [stream, text]),
            [
              ["supervisor", "termination requested"],
              ["stdout", "termination-tail"],
            ],
          )
          assert(
            typeof failure.cause === "object" &&
              failure.cause !== null &&
              "termination" in failure.cause &&
              "streams" in failure.cause,
          )
          assert.match(String(failure.cause.termination), /termination exploded/)
          assert(Array.isArray(failure.cause.streams))
          const streamFailure = failure.cause.streams[0]
          assert(
            typeof streamFailure === "object" && streamFailure !== null && "cause" in streamFailure,
          )
          assert.match(String(streamFailure.cause), /stream cleanup failed/)
        }).pipe(Effect.provide(layerFromBackend(backend))),
      )
    }),
  )

  it.effect("preserves started-process observations when exit and termination fail", () => {
    const backend: ProcessBackend = {
      spawn: () =>
        Effect.succeed({
          stdout: Stream.make("started"),
          stderr: Stream.empty,
          exitCode: Effect.fail(testFailure("exit exploded")),
          terminate: () => Effect.fail(testFailure("termination exploded")),
        }),
    }
    return Effect.scoped(
      Effect.gen(function* () {
        const supervisor = yield* ProcessSupervisor
        const running = yield* supervisor.start(spec)
        yield* Effect.yieldNow
        const exitFailure = yield* running.exitCode.pipe(Effect.flip)
        assert.strictEqual(exitFailure.reason, "exit")
        assert.deepEqual(
          exitFailure.observations.map(({ stream, text }) => [stream, text]),
          [["stdout", "started"]],
        )
        const terminationFailure = yield* running.terminate.pipe(Effect.flip)
        assert.strictEqual(terminationFailure.reason, "exit")
        assert.deepEqual(
          terminationFailure.observations.map(({ stream, text }) => [stream, text]),
          [
            ["stdout", "started"],
            ["supervisor", "termination requested"],
          ],
        )
      }).pipe(Effect.provide(layerFromBackend(backend))),
    )
  })

  it.effect("bounds retained output and records deterministic truncation metadata", () => {
    const backend: ProcessBackend = {
      spawn: () =>
        Effect.succeed({
          stdout: Stream.make("first-line\n", "second-line\n", "third-line\n"),
          stderr: Stream.empty,
          exitCode: Effect.succeed(0),
          terminate: () => Effect.void,
        }),
    }
    return Effect.gen(function* () {
      const supervisor = yield* ProcessSupervisor
      const result = yield* supervisor.run({
        command: "fake",
        timeoutMillis: 1_000,
        retainedOutputBytes: 1_000,
        retainedOutputLines: 2,
      })
      assert.deepEqual(
        result.observations.filter(({ stream }) => stream === "stdout").map(({ text }) => text),
        ["second-line", "third-line"],
      )
      assert.match(result.observations.at(-1)?.text ?? "", /omittedLines=1 omittedBytes=10/)
    }).pipe(Effect.provide(layerFromBackend(backend)))
  })

  it.effect(
    "bounds a real child process with newline-free UTF-8 output while draining it to completion",
    () =>
      Effect.gen(function* () {
        const byteLimit = 4_096
        const repetitions = 100_000
        const supervisor = yield* ProcessSupervisor
        const result = yield* supervisor.run({
          command: process.execPath,
          args: ["-e", `process.stdout.write("€".repeat(${repetitions}))`],
          timeoutMillis: 10_000,
          retainedOutputBytes: byteLimit,
          retainedOutputLines: 10,
        })
        assert.strictEqual(result.exitCode, 0)
        const stdout = result.observations.filter(({ stream }) => stream === "stdout")
        assert.strictEqual(stdout.length, 1)
        assert(encoder.encode(stdout[0]!.text).byteLength <= byteLimit)
        assert(!stdout[0]!.text.includes("�"))
        const truncation = result.observations.find(({ stream }) => stream === "supervisor")
        assert.strictEqual(
          truncation?.text,
          "output truncated: omittedLines=1 omittedBytes=295905 retainedBytes=4095",
        )
      }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(NodeServices.layer)))),
    15_000,
  )
})

const backendPlaceholder: ProcessBackend = {
  spawn: () =>
    Effect.succeed({
      stdout: Stream.make("out-1\n", "out-2\n"),
      stderr: Stream.make("err-1"),
      exitCode: Effect.succeed(7),
      terminate: () => Effect.void,
    }),
}
