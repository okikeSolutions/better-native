# better-native

Expo compatibility with an opt-in Effect-native API.

The repository is currently establishing its compatibility harness before implementing capability packages. The harness derives its manifest and test-suite denominator from pinned Expo and Effect revisions.

```sh
bun install
bun run better-native doctor
bun run generate
bun run compatibility
bun run matrix
bun run check
```

The architecture and compatibility contract live in [docs/architecture.md](./docs/architecture.md).
The documentation target lives in [docs/documentation.md](./docs/documentation.md).
