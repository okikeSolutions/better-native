import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as ExpoClipboard from "expo-clipboard"

/**
 * Clipboard content categories reported by native change events.
 *
 * @category models
 * @since 0.0.0
 */
export const ContentType = ExpoClipboard.ContentType
/**
 * Clipboard content category.
 *
 * @category models
 * @since 0.0.0
 */
export type ContentType = ExpoClipboard.ContentType
/**
 * String encodings supported by Expo Clipboard.
 *
 * @category models
 * @since 0.0.0
 */
export const StringFormat = ExpoClipboard.StringFormat
/**
 * String encoding supported by Expo Clipboard.
 *
 * @category models
 * @since 0.0.0
 */
export type StringFormat = ExpoClipboard.StringFormat
/**
 * Options for reading clipboard text.
 *
 * @category models
 * @since 0.0.0
 */
export type GetStringOptions = ExpoClipboard.GetStringOptions
/**
 * Android-specific options for writing clipboard text.
 *
 * @category models
 * @since 0.0.0
 */
export interface SetStringAndroidOptions {
  readonly isSensitive?: boolean
}
/**
 * Options for writing clipboard text.
 *
 * @category models
 * @since 0.0.0
 */
export interface SetStringOptions {
  readonly inputFormat?: StringFormat
  readonly android?: SetStringAndroidOptions
}
/**
 * Options for reading a clipboard image.
 *
 * @category models
 * @since 0.0.0
 */
export type GetImageOptions = ExpoClipboard.GetImageOptions
/**
 * Android-specific options for writing a clipboard image.
 *
 * @category models
 * @since 0.0.0
 */
export interface SetImageAndroidOptions {
  readonly isSensitive?: boolean
}
/**
 * Options for writing a clipboard image.
 *
 * @category models
 * @since 0.0.0
 */
export interface SetImageOptions {
  readonly android?: SetImageAndroidOptions
}
/**
 * Clipboard image data and dimensions.
 *
 * @category models
 * @since 0.0.0
 */
export type ClipboardImage = ExpoClipboard.ClipboardImage
/**
 * Native clipboard-change event.
 *
 * @category models
 * @since 0.0.0
 */
export type ClipboardEvent = ExpoClipboard.ClipboardEvent
/**
 * Native clipboard event subscription.
 *
 * @category models
 * @since 0.0.0
 */
export type Subscription = ExpoClipboard.Subscription

/**
 * Tagged failure from an Expo Clipboard operation.
 *
 * @category errors
 * @since 0.0.0
 */
export class ClipboardFailure extends Data.TaggedError("ClipboardFailure")<{
  readonly method: string
  readonly cause: unknown
}> {}

/**
 * Clipboard operations exposed by the Effect-native interface.
 *
 * @category services
 * @since 0.0.0
 */
export interface Service {
  readonly getString: (options: GetStringOptions) => Effect.Effect<string, ClipboardFailure>
  readonly setString: (
    text: string,
    options: SetStringOptions,
  ) => Effect.Effect<boolean, ClipboardFailure>
  readonly hasString: Effect.Effect<boolean, ClipboardFailure>
  readonly getUrl: Effect.Effect<string | null, ClipboardFailure>
  readonly setUrl: (url: string) => Effect.Effect<void, ClipboardFailure>
  readonly hasUrl: Effect.Effect<boolean, ClipboardFailure>
  readonly getImage: (
    options: GetImageOptions,
  ) => Effect.Effect<ClipboardImage | null, ClipboardFailure>
  readonly setImage: (
    base64Image: string,
    options: SetImageOptions,
  ) => Effect.Effect<void, ClipboardFailure>
  readonly hasImage: Effect.Effect<boolean, ClipboardFailure>
  readonly changes: Stream.Stream<ClipboardEvent, ClipboardFailure>
}

/**
 * Context tag for the clipboard service.
 *
 * @category services
 * @since 0.0.0
 */
export class Clipboard extends Context.Service<Clipboard, Service>()(
  "@better-native/clipboard/Clipboard",
) {}

const failure = (method: string, cause: unknown) => new ClipboardFailure({ method, cause })

const promiseMethod = <A>(method: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => failure(method, cause) })

type SetImageAsync = (base64Image: string, options?: SetImageOptions) => Promise<void>

/**
 * Reads clipboard text in the requested format.
 *
 * @category operations
 * @since 0.0.0
 */
export const getStringAsync = (options: GetStringOptions = {}) =>
  Effect.flatMap(Clipboard, (clipboard) => clipboard.getString(options))

/**
 * Writes text to the clipboard.
 *
 * @category operations
 * @since 0.0.0
 */
export const setStringAsync = (text: string, options: SetStringOptions = {}) =>
  Effect.flatMap(Clipboard, (clipboard) => clipboard.setString(text, options))

/**
 * Checks whether the clipboard contains text.
 *
 * @category operations
 * @since 0.0.0
 */
export const hasStringAsync = Effect.flatMap(Clipboard, (clipboard) => clipboard.hasString)

/**
 * Reads an iOS or macOS URL from the clipboard.
 *
 * @category operations
 * @since 0.0.0
 */
export const getUrlAsync = Effect.flatMap(Clipboard, (clipboard) => clipboard.getUrl)

/**
 * Writes an iOS or macOS URL to the clipboard.
 *
 * @category operations
 * @since 0.0.0
 */
export const setUrlAsync = (url: string) =>
  Effect.flatMap(Clipboard, (clipboard) => clipboard.setUrl(url))

/**
 * Checks whether the clipboard contains an iOS or macOS URL.
 *
 * @category operations
 * @since 0.0.0
 */
export const hasUrlAsync = Effect.flatMap(Clipboard, (clipboard) => clipboard.hasUrl)

/**
 * Reads an image from the clipboard.
 *
 * @category operations
 * @since 0.0.0
 */
export const getImageAsync = (options: GetImageOptions) =>
  Effect.flatMap(Clipboard, (clipboard) => clipboard.getImage(options))

/**
 * Writes a base64 image to the clipboard.
 *
 * @category operations
 * @since 0.0.0
 */
export const setImageAsync = (base64Image: string, options: SetImageOptions = {}) =>
  Effect.flatMap(Clipboard, (clipboard) => clipboard.setImage(base64Image, options))

/**
 * Checks whether the clipboard contains an image.
 *
 * @category operations
 * @since 0.0.0
 */
export const hasImageAsync = Effect.flatMap(Clipboard, (clipboard) => clipboard.hasImage)

/**
 * Streams native clipboard-change events and removes the native listener when its scope closes.
 *
 * Expo implements this listener as a no-op on web and macOS.
 *
 * @category streams
 * @since 0.0.0
 */
export const addClipboardListener = Stream.unwrap(
  Effect.map(Clipboard, (clipboard) => clipboard.changes),
)

const changes = Stream.callback<ClipboardEvent, ClipboardFailure>((queue) =>
  Effect.acquireRelease(
    Effect.try({
      try: () =>
        ExpoClipboard.addClipboardListener((event) => {
          Queue.offerUnsafe(queue, event)
        }),
      catch: (cause) => failure("addClipboardListener", cause),
    }).pipe(Effect.tapError((cause) => Queue.fail(queue, cause))),
    (subscription) => Effect.sync(() => subscription.remove()),
  ),
)

/**
 * Live clipboard layer backed by Expo Clipboard.
 *
 * @category layers
 * @since 0.0.0
 */
export const live = Layer.succeed(
  Clipboard,
  Clipboard.of({
    getString: (options) =>
      promiseMethod("getStringAsync", () => ExpoClipboard.getStringAsync(options)),
    setString: (text, options) =>
      promiseMethod("setStringAsync", () => ExpoClipboard.setStringAsync(text, options)),
    hasString: promiseMethod("hasStringAsync", ExpoClipboard.hasStringAsync),
    getUrl: promiseMethod("getUrlAsync", ExpoClipboard.getUrlAsync),
    setUrl: (url) => promiseMethod("setUrlAsync", () => ExpoClipboard.setUrlAsync(url)),
    hasUrl: promiseMethod("hasUrlAsync", ExpoClipboard.hasUrlAsync),
    getImage: (options) =>
      promiseMethod("getImageAsync", () => ExpoClipboard.getImageAsync(options)),
    setImage: (base64Image, options) =>
      promiseMethod("setImageAsync", () =>
        (ExpoClipboard.setImageAsync as SetImageAsync)(base64Image, options),
      ),
    hasImage: promiseMethod("hasImageAsync", ExpoClipboard.hasImageAsync),
    changes,
  }),
)

const initialEvent: ClipboardEvent = { contentTypes: [] }

/**
 * Atom containing the latest native clipboard-change event.
 *
 * It starts with an empty content-type list because Expo has no initial event snapshot operation.
 *
 * @category atoms
 * @since 0.0.0
 */
export const clipboardEventAtom = Atom.make(addClipboardListener.pipe(Stream.provide(live)), {
  initialValue: initialEvent,
})
