import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeWorker from "@effect/platform-node/NodeWorker"
import * as NodeWorkerRunner from "@effect/platform-node/NodeWorkerRunner"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { Worker as WorkerThread } from "node:worker_threads"

const spawnTrustedWorker = (worker: string) => {
  const thread = new WorkerThread(new URL(worker, import.meta.url), {
    // Candidate output is not part of the authenticated supervisor protocol. Keep it off the
    // container's stdout/stderr and continuously drain both streams to avoid backpressure.
    stdout: true,
    stderr: true,
  })
  thread.stdout.resume()
  thread.stderr.resume()
  return thread
}

/** Creates a supervisor runtime using Effect's Node Worker implementation. */
export const makeSupervisorRuntime = (worker: string) =>
  ManagedRuntime.make(
    Layer.merge(
      NodeServices.layer,
      NodeWorker.layer(() => spawnTrustedWorker(worker)),
    ),
  )

/** Creates an Effect Node WorkerRunner runtime inside one worker thread. */
export const makeWorkerRuntime = () =>
  ManagedRuntime.make(Layer.merge(NodeServices.layer, NodeWorkerRunner.layer))

/** Creates a managed NodeServices runtime for a non-worker isolated runner. */
export const makeRunnerRuntime = () => ManagedRuntime.make(NodeServices.layer)
