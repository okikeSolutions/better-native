# better-native

The Node-only installer and diagnostic CLI for Better Native capability packages.

```sh
npx better-native@alpha install network keep-awake
npx better-native@alpha doctor
```

Running through `npx` is transient: it does not save `better-native` to the application. Teams that
want a repository-pinned CLI may explicitly install `better-native@alpha` as a development
dependency; that choice is independent of the mobile runtime dependencies.

The CLI must run inside an existing Expo project with a project-local `expo` dependency. It installs
the selected Expo provider, exact `@better-native/<capability>` package, and exact Effect version in
one project-local Expo CLI transaction.

Supported capabilities are `network`, `battery`, `clipboard`, `keep-awake`, `secure-store`, and
`sqlite`.

Use `better-native install <capability...> --dry-run` to inspect the exact package plan without
changing the project. If multiple lockfiles exist, choose one package manager explicitly with
`--npm`, `--pnpm`, `--yarn`, or `--bun`.

The package contains no React Native APIs. Applications import the installed scoped package, for
example:

```ts
import { Network } from "@better-native/network"
```
