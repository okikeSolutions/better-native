// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("expo-keep-awake", async () => {
  const ReactModule = await import("react")
  const ExpoKeepAwakeTag = "ExpoKeepAwakeDefaultTag"
  const activateKeepAwake = vi.fn()
  const activateKeepAwakeAsync = vi.fn((_tag?: string) => Promise.resolve())
  const deactivateKeepAwake = vi.fn((_tag?: string) => Promise.resolve())
  return {
    ExpoKeepAwakeTag,
    KeepAwakeEventState: { RELEASE: "release" },
    activateKeepAwake,
    activateKeepAwakeAsync,
    addListener: vi.fn(),
    deactivateKeepAwake,
    isAvailableAsync: vi.fn(),
    useKeepAwake: (tag?: string) => {
      const defaultTag = ReactModule.useId()
      const tagOrDefault = tag ?? defaultTag
      ReactModule.useEffect(() => {
        void activateKeepAwakeAsync(tagOrDefault)
        return () => {
          void deactivateKeepAwake(tagOrDefault)
        }
      }, [tagOrDefault])
    },
  }
})

const ExpoCompat = await import("../src/Expo")
const ExpoKeepAwake = await import("expo-keep-awake")

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("@better-native/keep-awake/expo", () => {
  it("re-exports the Expo KeepAwake values without wrapping them", () => {
    expect(ExpoCompat.ExpoKeepAwakeTag).toBe(ExpoKeepAwake.ExpoKeepAwakeTag)
    expect(ExpoCompat.KeepAwakeEventState).toBe(ExpoKeepAwake.KeepAwakeEventState)
    expect(ExpoCompat.activateKeepAwake).toBe(ExpoKeepAwake.activateKeepAwake)
    expect(ExpoCompat.activateKeepAwakeAsync).toBe(ExpoKeepAwake.activateKeepAwakeAsync)
    expect(ExpoCompat.addListener).toBe(ExpoKeepAwake.addListener)
    expect(ExpoCompat.deactivateKeepAwake).toBe(ExpoKeepAwake.deactivateKeepAwake)
    expect(ExpoCompat.isAvailableAsync).toBe(ExpoKeepAwake.isAvailableAsync)
    expect(ExpoCompat.useKeepAwake).toBe(ExpoKeepAwake.useKeepAwake)
  })

  it("activates default and explicit hook leases until their React lifetime ends", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    const root = createRoot(document.createElement("div"))
    const Probe = () => {
      ExpoCompat.useKeepAwake()
      ExpoCompat.useKeepAwake("video-player")
      return null
    }

    await act(async () => {
      root.render(React.createElement(Probe))
    })

    expect(ExpoKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(2)
    expect(ExpoKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith("video-player")
    const generatedTag = vi
      .mocked(ExpoKeepAwake.activateKeepAwakeAsync)
      .mock.calls.map(([tag]) => tag)
      .find((tag) => tag !== "video-player")
    expect(generatedTag).toEqual(expect.any(String))
    expect(ExpoKeepAwake.deactivateKeepAwake).not.toHaveBeenCalled()

    await act(async () => {
      root.unmount()
    })

    expect(ExpoKeepAwake.deactivateKeepAwake).toHaveBeenCalledTimes(2)
    expect(ExpoKeepAwake.deactivateKeepAwake).toHaveBeenCalledWith(generatedTag)
    expect(ExpoKeepAwake.deactivateKeepAwake).toHaveBeenCalledWith("video-player")
  })
})
