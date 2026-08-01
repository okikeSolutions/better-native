# effect-expo contributor contract

Work through public package exports. Application code imports `@effect-expo/network`; only the reviewed adapter may import `expo-network` directly.

Do not edit files under `src/generated`. Network declarations and matrix metadata come from `packages/network/src/capabilities/network.json`. The Expo catalog comes from the pinned `vendor/expo` public manifests, bundled-module manifest, documentation metadata, and submodule revision. Change the applicable source, run `bun run generate`, and review the patch.

Domain modules return Effects. Effect runners belong in reviewed CLI or application runtime entrypoints. Production source never imports a `/testing` entrypoint.

Effect-returning unit tests use `it.effect` from `@effect/vitest`; do not add manual `Effect.runPromise` test boundaries. Keep pure synchronous tests on ordinary Vitest. Provide mutable test Layers per test, and use `it.layer` only when sharing a scoped Layer across the block is intentional. Use `it.effect.prop` with Schemas for stable invariants at declarative and native trust boundaries.

Native values are untrusted. Decode them at the adapter boundary and preserve typed capability failures rather than casting, throwing generic errors, or swallowing failures.

Before handing off a change, run:

```sh
bun run check
```

Use `bun run matrix` to inspect capability coverage. A bundled app is not native conformance; update platform evidence only after the applicable live vectors pass on that platform.
