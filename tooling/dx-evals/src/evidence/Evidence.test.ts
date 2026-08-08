import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as NodeCrypto from "@effect/platform-node/NodeCrypto"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as FileSystem from "effect/FileSystem"
import * as Config from "../Config.ts"
import * as ArtifactStore from "./ArtifactStore.ts"
import * as Domain from "../Domain.ts"
import * as Evidence from "./Evidence.ts"
import { provideLayer } from "../TestLayers.ts"

const manifest: Evidence.EvidenceManifest = {
  schemaVersion: 1,
  runId: Domain.RunId.make("run-1"),
  taskId: Domain.TaskId.make("synthetic-effect"),
  taskVersion: Domain.TaskVersion.make("1"),
  adapterId: Domain.AdapterId.make("reference"),
  instructionDigest: Domain.Sha256Digest.make("0".repeat(64)),
  evaluatorBundleDigest: Domain.Sha256Digest.make("f".repeat(64)),
  taskExportDigest: Domain.Sha256Digest.make("a".repeat(64)),
  submissionDigest: Domain.Sha256Digest.make("b".repeat(64)),
  observationDigest: Domain.Sha256Digest.make("c".repeat(64)),
  gateDigest: Domain.Sha256Digest.make("d".repeat(64)),
  taskSuccess: true,
  failureEvidence: [],
  isolationPolicy: {
    image: "example.invalid/sandbox@sha256:deadbeef",
    timeoutMilliseconds: 1_000,
    network: "none",
    filesystem: "read-only",
    user: "65532:65532",
  },
  usage: {},
}

describe("evidence authenticity", () => {
  it.effect("creates shared artifact directories idempotently across workers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const repositoryRoot = yield* fs.makeTempDirectoryScoped({ prefix: "dx-artifacts-" })
        const configLayer = Config.layer(repositoryRoot)
        const directories = yield* Effect.all(
          Array.from({ length: 8 }, () =>
            ArtifactStore.ensureDirectory("shared/workspaces").pipe(provideLayer(configLayer)),
          ),
          { concurrency: "unbounded" },
        )

        assert.strictEqual(new Set(directories).size, 1)
        assert.isTrue(yield* fs.exists(directories[0]!))
      }),
    ).pipe(provideLayer(NodeServices.layer)),
  )

  it.effect("accepts authentic evidence and rejects tampering or a foreign signature", () =>
    Effect.gen(function* () {
      const evidence = yield* Evidence.Evidence
      const signed = yield* evidence.seal(manifest)
      assert.match(signed.signature, /^[a-f0-9]{64}$/)
      assert.match(signed.digest, /^[a-f0-9]{64}$/)
      assert.deepStrictEqual(yield* evidence.seal(manifest), signed)
      assert.isTrue(yield* evidence.verify(signed))
      assert.isFalse(
        yield* evidence.verify({
          ...signed,
          manifest: {
            ...signed.manifest,
            submissionDigest: Domain.Sha256Digest.make("e".repeat(64)),
          },
        }),
      )

      const foreign = yield* Evidence.Evidence.pipe(
        provideLayer(Evidence.layerFromKey(new Uint8Array(32).fill(2))),
      )
      assert.isFalse(yield* evidence.verify(yield* foreign.seal(manifest)))
    }).pipe(
      provideLayer(
        Evidence.layerFromKey(new Uint8Array(32).fill(1)).pipe(
          Layer.provideMerge(NodeCrypto.layer),
        ),
      ),
    ),
  )

  it.effect("publishes a run identity once and rejects artifact-root symlinks", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const evidence = yield* Evidence.Evidence
        const signed = yield* evidence.seal(manifest)
        const repositoryRoot = yield* fs.makeTempDirectoryScoped({ prefix: "dx-evidence-" })
        const configLayer = Config.layer(repositoryRoot)
        const first = yield* Evidence.persist(manifest.runId, signed).pipe(
          provideLayer(configLayer),
        )
        assert.match(first, /evidence\.json$/)
        const duplicate = yield* Effect.exit(
          Evidence.persist(manifest.runId, signed).pipe(provideLayer(configLayer)),
        )
        assert.strictEqual(duplicate._tag, "Failure")

        const redirectedWorkspace = yield* fs.makeTempDirectoryScoped({
          prefix: "dx-workspace-redirect-",
        })
        yield* fs.symlink(redirectedWorkspace, `${repositoryRoot}/.artifacts/evals/workspaces`)
        const redirectedSubdirectory = yield* Effect.exit(
          ArtifactStore.ensureDirectory("workspaces").pipe(provideLayer(configLayer)),
        )
        assert.strictEqual(redirectedSubdirectory._tag, "Failure")

        const redirectedRoot = yield* fs.makeTempDirectoryScoped({ prefix: "dx-redirect-" })
        const symlinkRepository = yield* fs.makeTempDirectoryScoped({ prefix: "dx-symlink-" })
        yield* fs.makeDirectory(`${symlinkRepository}/.artifacts`, { recursive: true })
        yield* fs.symlink(redirectedRoot, `${symlinkRepository}/.artifacts/evals`)
        const redirected = yield* Effect.exit(
          Evidence.persist(Domain.RunId.make("redirected-run"), signed).pipe(
            provideLayer(Config.layer(symlinkRepository)),
          ),
        )
        assert.strictEqual(redirected._tag, "Failure")

        const redirectedParent = yield* fs.makeTempDirectoryScoped({
          prefix: "dx-parent-redirect-",
        })
        const parentSymlinkRepository = yield* fs.makeTempDirectoryScoped({
          prefix: "dx-parent-symlink-",
        })
        yield* fs.symlink(redirectedParent, `${parentSymlinkRepository}/.artifacts`)
        const parentRedirected = yield* Effect.exit(
          ArtifactStore.ensureRoot.pipe(provideLayer(Config.layer(parentSymlinkRepository))),
        )
        assert.strictEqual(parentRedirected._tag, "Failure")
        assert.isFalse(yield* fs.exists(`${redirectedParent}/evals`))

        const escaped = yield* Effect.exit(
          ArtifactStore.ensureDirectory("../escaped").pipe(provideLayer(configLayer)),
        )
        assert.strictEqual(escaped._tag, "Failure")
      }),
    ).pipe(
      provideLayer(
        Evidence.layerFromKey(new Uint8Array(32).fill(1)).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  )
})
