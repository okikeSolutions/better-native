import { describe, expect, it, vi } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import type { ContentType as ExpoContentType } from "expo-clipboard"

vi.mock("expo-clipboard", () => ({
  ContentType: { PLAIN_TEXT: "plain-text", HTML: "html", IMAGE: "image", URL: "url" },
  StringFormat: { PLAIN_TEXT: "plainText", HTML: "html" },
  ClipboardPasteButton: vi.fn(),
  isPasteButtonAvailable: false,
  getStringAsync: vi.fn(),
  setStringAsync: vi.fn(),
  hasStringAsync: vi.fn(),
  getUrlAsync: vi.fn(),
  setUrlAsync: vi.fn(),
  hasUrlAsync: vi.fn(),
  getImageAsync: vi.fn(),
  setImageAsync: vi.fn(),
  hasImageAsync: vi.fn(),
  addClipboardListener: vi.fn(),
  removeClipboardListener: vi.fn(),
}))

const ExpoClipboard = await import("expo-clipboard")
const { Clipboard, ClipboardFailure, ClipboardService, ContentType, StringFormat } =
  await import("../src/index")

const provideLayer =
  <ROut, E2, RIn>(layer: Layer.Layer<ROut, E2, RIn>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | E2, RIn | Exclude<R, ROut>> =>
    Effect.scoped(
      Layer.build(layer).pipe(Effect.flatMap((context) => Effect.provide(effect, context))),
    )

const emptyChanges = Stream.empty as Stream.Stream<never>

const fakeService = (values: Map<string, string>) =>
  Layer.succeed(
    ClipboardService,
    ClipboardService.of({
      getString: () => Effect.sync(() => values.get("text") ?? ""),
      setString: (text) => Effect.sync(() => (values.set("text", text), true)),
      hasString: Effect.sync(() => values.has("text")),
      getUrl: Effect.sync(() => values.get("url") ?? null),
      setUrl: (url) => Effect.sync(() => void values.set("url", url)),
      hasUrl: Effect.sync(() => values.has("url")),
      getImage: () => Effect.succeed(null),
      setImage: () => Effect.void,
      hasImage: Effect.succeed(false),
      changes: emptyChanges,
    }),
  )

describe("@better-native/clipboard", () => {
  it("supports a replaceable clipboard service", async () => {
    const values = new Map<string, string>()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Clipboard.setStringAsync("hello")
        yield* Clipboard.setUrlAsync("https://example.com")
        return {
          text: yield* Clipboard.getStringAsync(),
          hasText: yield* Clipboard.hasStringAsync,
          url: yield* Clipboard.getUrlAsync,
          hasUrl: yield* Clipboard.hasUrlAsync,
        }
      }).pipe(provideLayer(fakeService(values))),
    )

    expect(result).toEqual({
      text: "hello",
      hasText: true,
      url: "https://example.com",
      hasUrl: true,
    })
  })

  it("delegates text operations and preserves options", async () => {
    const getOptions = { preferredFormat: StringFormat.HTML }
    const setOptions = { inputFormat: StringFormat.HTML, android: { isSensitive: true } }
    vi.mocked(ExpoClipboard.setStringAsync).mockResolvedValueOnce(true)
    vi.mocked(ExpoClipboard.getStringAsync).mockResolvedValueOnce("<b>hello</b>")
    vi.mocked(ExpoClipboard.hasStringAsync).mockResolvedValueOnce(true)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const written = yield* Clipboard.setStringAsync("<b>hello</b>", setOptions)
        const text = yield* Clipboard.getStringAsync(getOptions)
        const present = yield* Clipboard.hasStringAsync
        return { written, text, present }
      }).pipe(provideLayer(Clipboard.live)),
    )

    expect(result).toEqual({ written: true, text: "<b>hello</b>", present: true })
    expect(ExpoClipboard.setStringAsync).toHaveBeenCalledWith("<b>hello</b>", setOptions)
    expect(ExpoClipboard.getStringAsync).toHaveBeenCalledWith(getOptions)
  })

  it("delegates URL and image operations", async () => {
    const image = { data: "data:image/png;base64,AA==", size: { width: 1, height: 1 } }
    const imageOptions = { format: "png" as const }
    const writeOptions = { android: { isSensitive: true } }
    vi.mocked(ExpoClipboard.setUrlAsync).mockResolvedValueOnce(undefined)
    vi.mocked(ExpoClipboard.getUrlAsync).mockResolvedValueOnce("https://example.com")
    vi.mocked(ExpoClipboard.hasUrlAsync).mockResolvedValueOnce(true)
    vi.mocked(ExpoClipboard.setImageAsync).mockResolvedValueOnce(undefined)
    vi.mocked(ExpoClipboard.getImageAsync).mockResolvedValueOnce(image)
    vi.mocked(ExpoClipboard.hasImageAsync).mockResolvedValueOnce(true)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Clipboard.setUrlAsync("https://example.com")
        const url = yield* Clipboard.getUrlAsync
        const hasUrl = yield* Clipboard.hasUrlAsync
        yield* Clipboard.setImageAsync("AA==", writeOptions)
        const storedImage = yield* Clipboard.getImageAsync(imageOptions)
        const hasImage = yield* Clipboard.hasImageAsync
        return { url, hasUrl, storedImage, hasImage }
      }).pipe(provideLayer(Clipboard.live)),
    )

    expect(result).toEqual({
      url: "https://example.com",
      hasUrl: true,
      storedImage: image,
      hasImage: true,
    })
    expect(ExpoClipboard.setImageAsync).toHaveBeenCalledWith("AA==", writeOptions)
    expect(ExpoClipboard.getImageAsync).toHaveBeenCalledWith(imageOptions)
  })

  it("wraps rejected native operations with method context", async () => {
    const nativeCause = new Error("clipboard denied")
    vi.mocked(ExpoClipboard.getStringAsync).mockRejectedValueOnce(nativeCause)

    const exit = await Effect.runPromiseExit(
      Clipboard.getStringAsync().pipe(provideLayer(Clipboard.live)),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    const reason = exit.cause.reasons.find(Cause.isFailReason)
    if (reason === undefined || !(reason.error instanceof ClipboardFailure)) {
      throw new Error("expected ClipboardFailure")
    }
    expect(reason.error.method).toBe("getStringAsync")
    expect(reason.error.cause).toBe(nativeCause)
  })

  it("streams native events in order and removes the subscription", async () => {
    const remove = vi.fn()
    vi.mocked(ExpoClipboard.addClipboardListener).mockImplementation((listener) => {
      listener({ contentTypes: [ContentType.PLAIN_TEXT] })
      listener({ contentTypes: [ContentType.IMAGE] })
      return { remove }
    })

    const result = await Effect.runPromise(
      Clipboard.addClipboardListener.pipe(
        Stream.take(2),
        Stream.runCollect,
        provideLayer(Clipboard.live),
      ),
    )

    expect(Array.from(result)).toEqual([
      { contentTypes: [ContentType.PLAIN_TEXT] },
      { contentTypes: [ContentType.IMAGE] },
    ])
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("fails when native listener registration throws", async () => {
    vi.mocked(ExpoClipboard.addClipboardListener).mockImplementationOnce(() => {
      throw new Error("listener unavailable")
    })

    const exit = await Effect.runPromiseExit(
      Clipboard.addClipboardListener.pipe(
        Stream.take(1),
        Stream.runCollect,
        provideLayer(Clipboard.live),
      ),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    const reason = exit.cause.reasons.find(Cause.isFailReason)
    if (reason === undefined || !(reason.error instanceof ClipboardFailure)) {
      throw new Error("expected ClipboardFailure")
    }
    expect(reason.error.method).toBe("addClipboardListener")
  })

  it("updates the clipboard event atom and releases its listener", async () => {
    let listener: ((event: { contentTypes: Array<ExpoContentType> }) => void) | undefined
    const remove = vi.fn()
    vi.mocked(ExpoClipboard.addClipboardListener).mockImplementation((callback) => {
      listener = callback
      return { remove }
    })
    const registry = AtomRegistry.make()
    const release = registry.mount(Clipboard.clipboardEventAtom)
    const value = () => {
      const result = registry.get(Clipboard.clipboardEventAtom)
      if (!AsyncResult.isSuccess(result)) throw new Error("expected clipboard atom value")
      return result.value
    }

    await vi.waitFor(() => expect(listener).toBeDefined())
    expect(value()).toEqual({ contentTypes: [] })
    listener?.({ contentTypes: [ContentType.URL] })
    await vi.waitFor(() => expect(value()).toEqual({ contentTypes: [ContentType.URL] }))

    release()
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
  })
})
