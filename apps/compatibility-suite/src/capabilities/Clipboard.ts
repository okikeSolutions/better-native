import { Clipboard } from "@better-native/clipboard"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as ExpoClipboard from "expo-clipboard"
import { Platform } from "react-native"

export const name = "Clipboard Effect capability"

interface JasmineApi {
  readonly describe: (name: string, spec: () => void) => void
  readonly it: (name: string, spec: () => Promise<void>) => void
}

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const run = <A, E>(effect: Effect.Effect<A, E, Clipboard.Clipboard>) =>
  // The Jasmine capability module is the application boundary for this selected run.
  // oxlint-disable-next-line effecttsgo/strict-effect-provide
  Effect.runPromise(effect.pipe(Effect.provide(Clipboard.live)))

const onePixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

export function test({ describe, it }: JasmineApi): void {
  describe(name, () => {
    it("round trips native text through the live layer and Expo provider", async () => {
      const first = `better-native-effect-${Platform.OS}`
      const effectWritten = await run(Clipboard.setStringAsync(first))
      assert(effectWritten, "Effect text write was not accepted")
      if (Platform.OS !== "web") {
        assert(
          (await ExpoClipboard.getStringAsync()) === first,
          "Expo did not read the Effect write",
        )
      }

      const second = `better-native-expo-${Platform.OS}`
      const expoWritten = await ExpoClipboard.setStringAsync(second)
      assert(expoWritten, "Expo text write was not accepted")
      if (Platform.OS !== "web") {
        assert(
          (await run(Clipboard.getStringAsync())) === second,
          "Effect did not read the Expo write",
        )
        assert(await run(Clipboard.hasStringAsync), "Effect did not report clipboard text")
      }
    })

    it("forwards native string formats and Android sensitivity", async () => {
      if (Platform.OS === "web") {
        assert(
          Clipboard.StringFormat.HTML === ExpoClipboard.StringFormat.HTML,
          "String format enum identity differed",
        )
        return
      }
      const html = "<b>better-native</b>"
      const written = await run(
        Clipboard.setStringAsync(html, {
          inputFormat: Clipboard.StringFormat.HTML,
          android: { isSensitive: true },
        }),
      )
      assert(written, "Formatted clipboard write was not accepted")
      const value = await run(
        Clipboard.getStringAsync({ preferredFormat: Clipboard.StringFormat.HTML }),
      )
      assert(value.length > 0, "Formatted clipboard read was empty")
    })

    it("round trips platform URL and image content where supported", async () => {
      if (Platform.OS === "ios") {
        const url = "https://better-native.dev/clipboard"
        await run(Clipboard.setUrlAsync(url))
        assert((await run(Clipboard.getUrlAsync)) === url, "Effect URL round trip differed")
        assert(await run(Clipboard.hasUrlAsync), "Effect did not report the URL")
      }
      if (Platform.OS === "ios" || Platform.OS === "android") {
        await run(Clipboard.setImageAsync(onePixelPng, { android: { isSensitive: true } }))
        assert(await run(Clipboard.hasImageAsync), "Effect did not report the image")
        const image = await run(Clipboard.getImageAsync({ format: "png" }))
        assert(image !== null, "Effect image read returned null")
        assert(image.size.width === 1 && image.size.height === 1, "Image dimensions differed")
      }
    })

    it("acquires and releases the native change stream and event atom", async () => {
      await run(
        Effect.gen(function* () {
          const fiber = yield* Clipboard.addClipboardListener.pipe(
            Stream.runDrain,
            Effect.forkChild,
          )
          yield* Effect.sleep("100 millis")
          yield* Fiber.interrupt(fiber)
        }),
      )

      const registry = AtomRegistry.make()
      const release = registry.mount(Clipboard.clipboardEventAtom)
      try {
        await new Promise((resolve) => setTimeout(resolve, 100))
      } finally {
        release()
      }
    })
  })
}
