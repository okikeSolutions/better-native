# Clipboard

Implement `src/ObserveClipboard.ts` using only the installed public `@better-native/clipboard`
package and normal `effect/*` entrypoints.

Export `clipboardContentTypes`, an Effect `Stream` that:

- consumes `Clipboard.addClipboardListener`;
- emits each event's `contentTypes` array;
- provides `Clipboard.live` at the application boundary; and
- preserves `ClipboardFailure` in the stream error channel when native listener registration fails.

The stream must be resource-safe. Stopping downstream consumption early must release the native
subscription. Do not construct a replacement stream from fixed values, call `expo-clipboard`
directly, or import better-native source files, package internals, or test doubles. Do not add files
or change the exported name.
