# @better-native/metro

The Metro resolution adapter used by Better Native's compatibility harness.

It wraps an Expo Metro configuration, routes reviewed package specifiers to candidate replacements,
keeps all other tracked imports on the pinned upstream installation, and emits structured resolution
evidence. The package is private and is currently harness infrastructure, not a general-purpose
application integration.

## Build

From the repository root:

```sh
bun run build --filter @better-native/metro
bun run check:dist
```

The package builds ESM and CommonJS runtime entrypoints plus TypeScript declarations under `dist/`.
`check:dist` verifies that committed distribution files match the source build.

## Configuration boundary

Expo applications begin with `getDefaultConfig` as described in Expo's
[Metro customization guide](https://docs.expo.dev/guides/customizing-metro/). The harness then calls
`withBetterNative(config, options)` at Metro's synchronous configuration boundary:

```ts
import { getDefaultConfig } from "expo/metro-config"
import { withBetterNative } from "@better-native/metro"

const config = getDefaultConfig(import.meta.dirname)

export default withBetterNative(config, {
  runId: "local-run",
  buildId: "local-build",
  mode: "candidate",
  replacements: [{ source: "expo-network", target: "@better-native/network/expo" }],
  upstreamNodeModulesPath: "/absolute/path/to/pinned-expo/node_modules",
})
```

The compatibility harness generates these options from reviewed ownership data and validated
environment inputs. Application code should not copy the example with an arbitrary Expo checkout
or replacement list.

## Resolution policy

- `candidate` mode replaces only configured source specifiers.
- `upstream` mode resolves tracked sources from the pinned Expo installation.
- imports made by a replacement package back to its own Expo provider are classified as
  `self-upstream` to prevent recursive replacement;
- untracked imports retain Metro's normal resolution behavior; and
- a second attempt to configure the same Metro object fails closed.

`onResolution` can receive structured decisions and outcomes for evidence. Observer failures are
logged without changing Metro's resolution result; invalid configuration fails with
`MetroConfigurationError` before the wrapped config is returned.
