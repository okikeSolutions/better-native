# better-native

Expo compatibility with an opt-in Effect-native API.

The repository is currently establishing its compatibility harness before implementing capability packages. The harness derives its manifest and test-suite denominator from pinned Expo and Effect revisions.

## Local Expo research source

Expo source is intentionally kept outside this repository so ordinary clones and deployments do not
download it. Clone the pinned revision next to this repository (the default is `../expo`) or copy
`.env.example` to `.env.local` and set `EXPO_SOURCE_ROOT` to another checkout. Compatibility CI
creates this source checkout explicitly when it needs Expo's internal test corpus.

```sh
bun install
bun run expo:prepare
bun run generate
bun run compatibility
bun run matrix
bun run check
```

The architecture and compatibility contract live in [docs/architecture.md](./docs/architecture.md).
The documentation target lives in [docs/documentation.md](./docs/documentation.md).
