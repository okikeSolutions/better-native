# @better-native/keep-awake

Effect-native screen wake-lock management with an Expo-compatible entrypoint.

The package has two public boundaries:

- `@better-native/keep-awake` provides typed Effects, a scoped resource, a Stream, and an Effect
  Atom;
- `@better-native/keep-awake/expo` preserves the `expo-keep-awake` import surface for incremental
  migration.

See Expo's [KeepAwake documentation](https://docs.expo.dev/versions/latest/sdk/keep-awake/) for the
underlying native module and platform support. This guide documents the Better Native integration;
API mapping coverage alone is not evidence of native behavioral parity.

## Installation

Install the native provider, this package, and its Effect peer in one Expo CLI transaction:

```sh
npx expo install expo-keep-awake @better-native/keep-awake@alpha effect@4.0.0-rc.108
```

Expo selects the `expo-keep-awake` version compatible with the application's SDK. The Better Native
and Effect specifications remain explicit because Expo does not version those third-party
packages.

`expo-keep-awake` remains installed because Better Native delegates to its native module. After
changing native dependencies, rebuild the development client or native application when the
provider is not already present in that binary; restarting Metro alone does not update native
binaries. The module does not require an application permission or package-specific config plugin.

## Scoped Effect API

Prefer `keepAwake` for application work. It acquires a tagged lease and registers deactivation as an
Effect finalizer, so normal completion, failure, and interruption all run cleanup.

```ts
import { keepAwake, live } from "@better-native/keep-awake"
import * as Effect from "effect/Effect"

const playVideo = Effect.scoped(
  Effect.gen(function* () {
    const tag = yield* keepAwake({ tag: "video-player" })
    yield* Effect.log(`Keeping the screen awake with ${tag}`)
    yield* Effect.never
  }),
).pipe(Effect.provide(live))

// Execute `playVideo` from an application boundary and interrupt its Fiber when playback ends.
```

Omit `tag` to receive a unique generated tag. Generated tags isolate concurrent scoped callers so
one scope cannot deactivate another scope's lease. Supply a stable tag when application code needs
to identify or share the same lease deliberately. Scoped leases with the same explicit tag are
reference-counted per service: the first scope activates the native lease and only the last scope to
close deactivates it.

`keepAwake` can fail with `KeepAwakeUnavailable` before acquisition or `KeepAwakeFailure` when the
underlying operation fails. A deactivation failure occurs in the finalizer and is retained as an
Effect defect rather than silently discarded.

## Manual activation

The exact-name manual APIs are available for integrations that cannot use an Effect scope:

```ts
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
  ExpoKeepAwakeTag,
  live,
} from "@better-native/keep-awake"
import * as Effect from "effect/Effect"

const activate = activateKeepAwakeAsync(ExpoKeepAwakeTag).pipe(Effect.provide(live))
const deactivate = deactivateKeepAwake(ExpoKeepAwakeTag).pipe(Effect.provide(live))
```

The tag is optional for the manual APIs. Omitting it uses `ExpoKeepAwakeTag`, matching Expo's shared
default. Activating two independent features with that default means either feature can deactivate
the shared lease, so prefer explicit tags or the scoped `keepAwake` API for concurrent work.

`activateKeepAwake` is retained only as Expo's deprecated exact-name alias. New code should use
`activateKeepAwakeAsync`.

## Events and React

`addListener(tag?)` is the Effect-native Stream counterpart of Expo's listener API. Its subscription
is removed when the consuming Stream scope closes. Expo documents keep-awake state events as a web
facility; do not use event delivery as a native lifecycle signal.

`keepAwakeAtom(tag?)` is the React integration. Mount it through `@effect/atom-react` to acquire a
lease and unmount its last consumer to release it. Calls using the same explicit tag return the same
Atom and share one lease. Calls without a tag share the package's untagged Atom, whose underlying
scoped acquisition still receives an isolated generated lease tag.

## Expo-compatible import

For a low-churn migration, change only the module specifier:

```ts
import { useKeepAwake } from "@better-native/keep-awake/expo"
```

The `/expo` entrypoint is generated from the pinned Expo surface and delegates to
`expo-keep-awake`. Its hooks and Promise-based functions retain Expo behavior and types; they do not
return Effects. Import from the package root when opting into the Effect-native API.

The repository compatibility harness can also route the unchanged `expo-keep-awake` specifier to
this generated entrypoint in a candidate bundle. That Metro routing is test infrastructure, not a
requirement for applications that import `@better-native/keep-awake/expo` directly.

## Evidence boundaries

Use `bun run coverage` from the repository root to inspect exact export mappings. Use the paired
compatibility harness for platform behavior evidence. Unit tests, a successful build, the quick
interactive smoke suite, and deterministic DX evals validate narrower contracts; none alone proves
platform parity.

The current prototype has paired Release evidence for the pinned Expo revision on an iOS 26.5
simulator, an Android API 36 emulator, and Playwright Chromium. The pinned native KeepAwake source
matched all four cases on iOS and Android. Web uses the reviewed supplemental KeepAwake capability
source and matched all seven cases across default and explicit tags, hook lifecycle, listener
cleanup, release events, platform errors, and concurrent-tag isolation. Expo's pinned web source is
not used as the web verdict because its `afterAll` deactivates already-released tags and fails
against Expo's own web implementation. These results are simulator, emulator, and browser
evidence—not physical-device evidence. No paid-evaluation result is claimed by this package guide.

On that evidence, `compatibility/ownership.json` classifies the root `expo-keep-awake` contract as
`effect` owned. The ownership claim covers Better Native's JavaScript API, lifecycle behavior, and
candidate replacement; the live layer still uses Expo as its native capability provider.
