import * as Context from "effect/Context"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { HarnessError } from "./HarnessError.ts"

export const GitRevision = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => /^[0-9a-f]{40}$/.test(value), {
      expected: "a full 40-character lowercase Git revision",
    }),
  ),
)

const RepositoryRelativePath = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) =>
        value.length > 0 &&
        !value.includes("\0") &&
        !/^(?:[A-Za-z]:)?[\\/]/.test(value) &&
        !value.split(/[\\/]/).some((segment) => segment === ".."),
      { expected: "a non-empty repository-relative path without parent traversal" },
    ),
  ),
)

const Upstream = Schema.Struct({
  repository: Schema.String,
  revision: GitRevision,
  path: RepositoryRelativePath,
})

const ExternalUpstream = Schema.Struct({
  repository: Schema.String,
  revision: GitRevision,
})

export const Upstreams = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  effect: Upstream,
  expo: ExternalUpstream,
})

export type Upstreams = Schema.Schema.Type<typeof Upstreams>

export interface Service {
  readonly root: string
  readonly expoRoot: string
  readonly effectRoot: string
  readonly upstreams: Upstreams
  readonly readJson: <S extends Schema.ConstraintDecoder<unknown>>(
    relativePath: string,
    schema: S,
  ) => Effect.Effect<S["Type"], HarnessError>
  readonly readExpoJson: <S extends Schema.ConstraintDecoder<unknown>>(
    relativePath: string,
    schema: S,
  ) => Effect.Effect<S["Type"], HarnessError>
  readonly readExpoText: (relativePath: string) => Effect.Effect<string, HarnessError>
  readonly expoFiles: Effect.Effect<ReadonlyArray<string>, HarnessError>
  readonly hashString: (value: string) => Effect.Effect<string, HarnessError>
  readonly writeArtifact: (
    relativePath: string,
    value: string,
  ) => Effect.Effect<string, HarnessError>
  readonly verify: Effect.Effect<void, HarnessError>
}

export class ExpoRepository extends Context.Service<ExpoRepository, Service>()(
  "@better-native/compatibility-harness/ExpoRepository",
) {}

const failure = (operation: string, path: string | undefined, cause: unknown): HarnessError =>
  new HarnessError({ operation, ...(path === undefined ? {} : { path }), cause })

export const layer = (
  root: string,
  expoSourceRoot?: string,
): Layer.Layer<
  ExpoRepository,
  HarnessError,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto | ChildProcessSpawner.ChildProcessSpawner
> =>
  Layer.effect(
    ExpoRepository,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const crypto = yield* Crypto.Crypto
      const childProcesses = yield* ChildProcessSpawner.ChildProcessSpawner
      const canonicalRoot = yield* fs
        .realPath(root)
        .pipe(Effect.mapError((cause) => failure("resolve repository root", root, cause)))

      const resolveWithin = (
        base: string,
        relativePath: string,
        operation: string,
      ): Effect.Effect<string, HarnessError> => {
        const segments = relativePath.split(/[\\/]/)
        if (
          relativePath.length === 0 ||
          relativePath.includes("\0") ||
          path.isAbsolute(relativePath) ||
          segments.some((segment) => segment === "..")
        ) {
          return Effect.fail(
            failure(operation, relativePath, "path must be a non-empty relative path without '..'"),
          )
        }
        const target = path.resolve(base, relativePath)
        const relation = path.relative(path.resolve(base), target)
        return relation === "" || (!relation.startsWith(`..${path.sep}`) && relation !== "..")
          ? Effect.succeed(target)
          : Effect.fail(failure(operation, relativePath, "path escapes its repository root"))
      }

      const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
        absolutePath: string,
        schema: S,
      ): Effect.Effect<S["Type"], HarnessError> =>
        fs.readFileString(absolutePath).pipe(
          Effect.mapError((cause) => failure("read JSON", absolutePath, cause)),
          Effect.flatMap((text) =>
            Effect.try({
              try: () => JSON.parse(text) as unknown,
              catch: (cause) => failure("parse JSON", absolutePath, cause),
            }),
          ),
          Effect.flatMap(Schema.decodeUnknownEffect(schema)),
          Effect.mapError((cause) =>
            cause instanceof HarnessError ? cause : failure("decode JSON", absolutePath, cause),
          ),
        )

      const upstreams = yield* decodeJson(
        path.join(root, "compatibility/upstreams.json"),
        Upstreams,
      )
      const resolveUpstream = (configuredPath: string, name: string) =>
        resolveWithin(root, configuredPath, `resolve ${name} upstream`).pipe(
          Effect.flatMap((target) =>
            fs.realPath(target).pipe(
              Effect.mapError((cause) => failure(`resolve ${name} upstream`, target, cause)),
              Effect.flatMap((canonical) =>
                canonical ===
                  path.resolve(canonicalRoot, path.relative(path.resolve(root), target)) &&
                (canonical === canonicalRoot || canonical.startsWith(`${canonicalRoot}${path.sep}`))
                  ? Effect.succeed(canonical)
                  : Effect.fail(
                      failure(
                        `resolve ${name} upstream`,
                        target,
                        `configured upstream must be a real directory inside the repository; resolved to ${canonical}`,
                      ),
                    ),
              ),
            ),
          ),
        )
      const effectRoot = yield* resolveUpstream(upstreams.effect.path, "Effect")
      const configuredExpoRoot =
        expoSourceRoot ?? process.env.EXPO_SOURCE_ROOT ?? path.join(root, "..", "expo")
      const expoRoot = path.resolve(configuredExpoRoot)
      const resolveExpoRoot = fs
        .realPath(expoRoot)
        .pipe(
          Effect.mapError((cause) =>
            failure(
              "resolve Expo source",
              expoRoot,
              `${String(cause)}; clone Expo next to this repository or set EXPO_SOURCE_ROOT`,
            ),
          ),
        )

      const revision = (directory: string): Effect.Effect<string, HarnessError> =>
        childProcesses
          .string(ChildProcess.make("git", ["-C", directory, "rev-parse", "HEAD"]))
          .pipe(
            Effect.map((value) => value.trim()),
            Effect.mapError((cause) => failure("read Git revision", directory, cause)),
          )

      const verify = Effect.gen(function* () {
        const canonicalExpoRoot = yield* resolveExpoRoot
        for (const [name, directory, expected] of [
          ["Expo", canonicalExpoRoot, upstreams.expo.revision],
          ["Effect", effectRoot, upstreams.effect.revision],
        ] as const) {
          const actual = yield* revision(directory)
          if (actual !== expected) {
            return yield* failure(
              "verify upstream revision",
              directory,
              `${name} is ${actual}; expected ${expected}`,
            )
          }
        }
        return undefined
      })

      return ExpoRepository.of({
        root,
        expoRoot,
        effectRoot,
        upstreams,
        readJson: (relativePath, schema) =>
          resolveWithin(root, relativePath, "resolve repository JSON").pipe(
            Effect.flatMap((absolutePath) => decodeJson(absolutePath, schema)),
          ),
        readExpoJson: (relativePath, schema) =>
          resolveExpoRoot.pipe(
            Effect.flatMap((canonicalExpoRoot) =>
              resolveWithin(canonicalExpoRoot, relativePath, "resolve Expo JSON"),
            ),
            Effect.flatMap((absolutePath) => decodeJson(absolutePath, schema)),
          ),
        readExpoText: (relativePath) =>
          resolveExpoRoot.pipe(
            Effect.flatMap((canonicalExpoRoot) =>
              resolveWithin(canonicalExpoRoot, relativePath, "resolve Expo source"),
            ),
            Effect.flatMap((absolutePath) =>
              fs
                .readFileString(absolutePath)
                .pipe(Effect.mapError((cause) => failure("read Expo source", absolutePath, cause))),
            ),
          ),
        expoFiles: resolveExpoRoot.pipe(
          Effect.flatMap((canonicalExpoRoot) =>
            childProcesses.string(ChildProcess.make("git", ["-C", canonicalExpoRoot, "ls-files"])),
          ),
          Effect.map((output) =>
            output
              .split("\n")
              .filter((file) => file.length > 0)
              .toSorted(),
          ),
          Effect.mapError((cause) => failure("list Expo source", expoRoot, cause)),
        ),
        hashString: (value) =>
          crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(
            Effect.map(Encoding.encodeHex),
            Effect.mapError((cause) => failure("hash compatibility data", undefined, cause)),
          ),
        writeArtifact: (relativePath, value) =>
          Effect.gen(function* () {
            const artifactRoot = path.join(root, ".artifacts")
            const output = yield* resolveWithin(artifactRoot, relativePath, "resolve artifact path")
            const directory = path.dirname(output)
            yield* fs
              .makeDirectory(directory, { recursive: true })
              .pipe(
                Effect.mapError((cause) => failure("create artifact directory", directory, cause)),
              )
            const canonicalArtifactRoot = yield* fs
              .realPath(artifactRoot)
              .pipe(
                Effect.mapError((cause) => failure("validate artifact root", artifactRoot, cause)),
              )
            if (canonicalArtifactRoot !== path.join(canonicalRoot, ".artifacts")) {
              return yield* failure(
                "validate artifact root",
                artifactRoot,
                `symbolic-link path resolves to ${canonicalArtifactRoot}`,
              )
            }
            const canonicalDirectory = yield* fs
              .realPath(directory)
              .pipe(
                Effect.mapError((cause) =>
                  failure("validate artifact directory", directory, cause),
                ),
              )
            const expectedDirectory = path.resolve(
              canonicalArtifactRoot,
              path.relative(artifactRoot, directory),
            )
            if (canonicalDirectory !== expectedDirectory) {
              return yield* failure(
                "validate artifact directory",
                directory,
                `symbolic-link path resolves to ${canonicalDirectory}`,
              )
            }
            if (
              yield* fs
                .exists(output)
                .pipe(Effect.mapError((cause) => failure("inspect artifact target", output, cause)))
            ) {
              const canonicalOutput = yield* fs
                .realPath(output)
                .pipe(
                  Effect.mapError((cause) => failure("validate artifact target", output, cause)),
                )
              if (canonicalOutput !== path.join(canonicalDirectory, path.basename(output))) {
                return yield* failure(
                  "validate artifact target",
                  output,
                  `symbolic-link target resolves to ${canonicalOutput}`,
                )
              }
            }
            const temporary = yield* fs
              .makeTempFile({
                directory: canonicalDirectory,
                prefix: `.${path.basename(output)}.`,
                suffix: ".tmp",
              })
              .pipe(Effect.mapError((cause) => failure("create temporary artifact", output, cause)))
            yield* fs
              .writeFileString(temporary, value)
              .pipe(
                Effect.mapError((cause) => failure("write temporary artifact", temporary, cause)),
              )
            yield* fs
              .rename(temporary, output)
              .pipe(Effect.mapError((cause) => failure("publish artifact", output, cause)))
            return output
          }),
        verify,
      })
    }),
  )
