# @better-native/clipboard

Effect-native clipboard reads, writes, and change events with an Expo-compatible entrypoint.

The package has two public interfaces:

- `@better-native/clipboard` provides typed Effects, a scoped Stream, an Atom, and a replaceable
  clipboard service;
- `@better-native/clipboard/expo` preserves the `expo-clipboard` interface for incremental
  migration, including `ClipboardPasteButton`.

See Expo's [Clipboard documentation](https://docs.expo.dev/versions/latest/sdk/clipboard/) for
platform permission prompts, supported content types, and paste-button requirements.

## Installation

Install the native provider, this package, and Effect together:

```sh
npx expo install expo-clipboard @better-native/clipboard@alpha effect@4.0.0-rc.112
```

Rebuild the native application after adding `expo-clipboard`.

## Effect interface

```ts
import { Clipboard } from "@better-native/clipboard"
import * as Effect from "effect/Effect"

const copyAndRead = Effect.gen(function* () {
  yield* Clipboard.setStringAsync("copied with Effect")
  return yield* Clipboard.getStringAsync()
}).pipe(Effect.provide(Clipboard.live))
```

String and image options pass through to Expo, including Android's `isSensitive` setting. URL
operations retain Expo's iOS and macOS availability contract. Native rejections fail with
`ClipboardFailure`, which records the method and original cause.

## Events and React

`Clipboard.addClipboardListener` is a scoped `Stream<ClipboardEvent, ClipboardFailure>`. Closing
its scope removes the Expo subscription. Expo does not emit clipboard events on web or macOS.

`Clipboard.clipboardEventAtom` contains the latest event. It starts with an empty `contentTypes`
array because Expo does not expose an initial clipboard-event snapshot.

## Expo-compatible import

Change only the module specifier when existing code must keep Promise, callback, component, and
type behavior:

```ts
import { ClipboardPasteButton, getStringAsync } from "@better-native/clipboard/expo"
```

The `/expo` entrypoint delegates directly to `expo-clipboard`. Use the package root for Effects,
Streams, the Atom, and typed failures.

## Evidence boundary

Host tests cover option forwarding, text, URL, and image operations, typed native failures, event
ordering, and scoped listener cleanup. The compatibility ownership ledger classifies Clipboard as
`effect`. Paired Release comparisons pass all four reviewed cases on web, iOS, and Android with zero
divergences. Expo remains the native provider behind `Clipboard.live`.
