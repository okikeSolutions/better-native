# @effect-expo/typescript-config

Shared TypeScript policy for the `effect-expo` Bun workspace.

## Presets

- `@effect-expo/typescript-config/base` — strict shared language, module-resolution, and Effect LSP policy.
- `@effect-expo/typescript-config/library` — base policy plus source-first library checking with no emit.
- `@effect-expo/typescript-config/node` — library policy plus Node.js ambient types for tooling packages.

Each package retains a local `tsconfig.json` for its owned files, test types, and justified exceptions.

Consumers of these presets install their own compatible `typescript` and `@effect/language-service` versions. The presets never patch or mutate the TypeScript compiler.
