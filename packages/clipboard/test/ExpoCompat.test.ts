import { describe, expect, it, vi } from "vitest"

vi.mock("expo-clipboard", () => ({
  ContentType: { PLAIN_TEXT: "plain-text", HTML: "html", IMAGE: "image", URL: "url" },
  StringFormat: { PLAIN_TEXT: "plainText", HTML: "html" },
  ClipboardPasteButton: vi.fn(),
  isPasteButtonAvailable: true,
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
const ExpoCompat = await import("../src/Expo")

describe("@better-native/clipboard/expo", () => {
  it("preserves every Expo Clipboard runtime export by identity", () => {
    for (const name of [
      "ClipboardPasteButton",
      "ContentType",
      "StringFormat",
      "addClipboardListener",
      "getImageAsync",
      "getStringAsync",
      "getUrlAsync",
      "hasImageAsync",
      "hasStringAsync",
      "hasUrlAsync",
      "isPasteButtonAvailable",
      "removeClipboardListener",
      "setImageAsync",
      "setStringAsync",
      "setUrlAsync",
    ] as const) {
      expect(ExpoCompat[name]).toBe(ExpoClipboard[name])
    }
  })
})
