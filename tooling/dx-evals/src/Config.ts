import * as Context from "effect/Context"
import * as Layer from "effect/Layer"

/** Validated host paths shared by DX eval services. */
export interface Service {
  readonly repositoryRoot: string
  readonly artifactsRoot: string
  readonly effectPackageRoot: string
  readonly effectRuntimePackages: ReadonlyArray<{
    readonly name: string
    readonly root: string
  }>
  readonly runnerRuntimePackages: ReadonlyArray<{
    readonly name: string
    readonly root: string
  }>
  readonly evalRunnerRoot: string
  readonly podmanExecutable: string
  readonly bunExecutable: string
  readonly tarExecutable: string
  readonly sandboxImage: string
  readonly sandboxLabel: string
  readonly sandboxTimeoutMilliseconds: number
}

/** Effect context tag for the DX eval host-configuration boundary. */
export class DxEvalConfig extends Context.Service<DxEvalConfig, Service>()(
  "@better-native/dx-evals/Config",
) {}

/**
 * Builds deterministic host configuration from the resolved repository root.
 *
 * @param repositoryRoot - Absolute better-native repository root resolved by the entrypoint.
 * @returns A layer providing {@link DxEvalConfig}.
 */
export const layer = (repositoryRoot: string) =>
  Layer.succeed(
    DxEvalConfig,
    DxEvalConfig.of({
      repositoryRoot,
      artifactsRoot: `${repositoryRoot}/.artifacts/evals`,
      effectPackageRoot: `${repositoryRoot}/node_modules/effect`,
      effectRuntimePackages: [
        { name: "fast-check", root: `${repositoryRoot}/node_modules/fast-check` },
        { name: "pure-rand", root: `${repositoryRoot}/node_modules/pure-rand` },
      ],
      runnerRuntimePackages: [
        {
          name: "typescript",
          root: `${repositoryRoot}/node_modules/typescript`,
        },
        {
          name: "@effect/platform-node",
          root: `${repositoryRoot}/node_modules/@effect/platform-node`,
        },
        {
          name: "@effect/platform-node-shared",
          root: `${repositoryRoot}/node_modules/@effect/platform-node-shared`,
        },
      ],
      evalRunnerRoot: `${repositoryRoot}/tooling/dx-evals/runner`,
      podmanExecutable: "podman",
      bunExecutable: "bun",
      tarExecutable: "tar",
      sandboxImage:
        "docker.io/library/node@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd",
      sandboxLabel: "io.better-native.dx-evals=true",
      sandboxTimeoutMilliseconds: 15_000,
    }),
  )

/** Builds a configuration layer from an already validated service for focused tests. */
export const layerFromService = (service: Service) =>
  Layer.succeed(DxEvalConfig, DxEvalConfig.of(service))
