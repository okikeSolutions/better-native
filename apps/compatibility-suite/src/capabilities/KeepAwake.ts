import { createElement } from "react"
import { Platform } from "react-native"
import * as KeepAwake from "expo-keep-awake"

export const name = "KeepAwake capability"

interface JasmineApi {
  readonly describe: (name: string, spec: () => void) => void
  readonly it: (name: string, spec: () => Promise<void>) => void
}

interface TestTools {
  readonly setPortalChild: (child: ReturnType<typeof createElement>) => void
  readonly cleanupPortal: () => Promise<void>
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const withTimeout = <A>(promise: Promise<A>, label: string): Promise<A> =>
  Promise.race([
    promise,
    delay(3_000).then(() => {
      throw new Error(`Timed out waiting for ${label}`)
    }),
  ])

const captureError = async (operation: () => unknown): Promise<unknown> => {
  try {
    await operation()
  } catch (cause) {
    return cause
  }
  throw new Error("Expected KeepAwake operation to fail")
}

const cleanupTag = async (tag: string): Promise<void> => {
  try {
    await KeepAwake.deactivateKeepAwake(tag)
  } catch {
    // Cleanup is best-effort because web rejects tags that were already released.
  }
}

export function test({ describe, it }: JasmineApi, tools: TestTools): void {
  describe(name, () => {
    it("balances the default tag", async () => {
      if (!(await KeepAwake.isAvailableAsync())) throw new Error("KeepAwake is unavailable")
      await KeepAwake.activateKeepAwakeAsync()
      await KeepAwake.deactivateKeepAwake()
    })

    it("balances an explicit tag", async () => {
      if (!(await KeepAwake.isAvailableAsync())) throw new Error("KeepAwake is unavailable")
      await KeepAwake.activateKeepAwakeAsync("better-native-capability")
      await KeepAwake.deactivateKeepAwake("better-native-capability")
    })

    it("mounts and unmounts the hook", async () => {
      const tag = "better-native-hook"
      let release: ((event: KeepAwake.KeepAwakeEvent) => void) | undefined
      const released = new Promise<KeepAwake.KeepAwakeEvent>((resolve) => {
        release = resolve
      })
      const Probe = () => {
        KeepAwake.useKeepAwake(tag, {
          listener: (event) => release?.(event),
          suppressDeactivateWarnings: true,
        })
        return null
      }

      tools.setPortalChild(createElement(Probe))
      await delay(200)
      await tools.cleanupPortal()
      if (Platform.OS === "web") {
        const event = await withTimeout(released, "the hook release event")
        if (event.state !== KeepAwake.KeepAwakeEventState.RELEASE) {
          throw new Error(`Unexpected hook release state: ${event.state}`)
        }
      }
    })

    it("manages listener subscriptions", async () => {
      if (Platform.OS !== "web") return
      const tag = "better-native-listener-removal"
      let releases = 0
      await KeepAwake.activateKeepAwakeAsync(tag)
      const subscription = KeepAwake.addListener(tag, () => {
        releases += 1
      })
      try {
        subscription.remove()
        await KeepAwake.deactivateKeepAwake(tag)
        await delay(50)
        if (releases !== 0) throw new Error("Removed KeepAwake listener received a release event")
      } finally {
        subscription.remove()
        await cleanupTag(tag)
      }
    })

    it("emits release events", async () => {
      if (Platform.OS !== "web") return
      const tag = "better-native-release-event"
      let release: ((event: KeepAwake.KeepAwakeEvent) => void) | undefined
      const released = new Promise<KeepAwake.KeepAwakeEvent>((resolve) => {
        release = resolve
      })
      await KeepAwake.activateKeepAwakeAsync(tag)
      const subscription = KeepAwake.addListener(tag, (event) => release?.(event))
      try {
        await KeepAwake.deactivateKeepAwake(tag)
        const event = await withTimeout(released, "the manual release event")
        if (event.state !== KeepAwake.KeepAwakeEventState.RELEASE) {
          throw new Error(`Unexpected manual release state: ${event.state}`)
        }
      } finally {
        subscription.remove()
        await cleanupTag(tag)
      }
    })

    it("preserves platform errors", async () => {
      if (Platform.OS === "web") {
        const error = await captureError(() =>
          KeepAwake.deactivateKeepAwake("better-native-never-activated"),
        )
        if (
          typeof error !== "object" ||
          error === null ||
          Reflect.get(error, "code") !== "ERR_KEEP_AWAKE_TAG_INVALID"
        ) {
          throw new Error(`Unexpected KeepAwake web error: ${String(error)}`)
        }
        return
      }

      const error = await captureError(() => KeepAwake.addListener(() => undefined))
      if (!(error instanceof Error) || !error.message.includes("addListenerForTag")) {
        throw new Error(`Unexpected KeepAwake native error: ${String(error)}`)
      }
    })

    it("isolates concurrent tags", async () => {
      const first = "better-native-concurrent-first"
      const second = "better-native-concurrent-second"
      const state = { secondReleases: 0 }
      const releaseCount = () => state.secondReleases
      let subscription: ReturnType<typeof KeepAwake.addListener> | undefined
      await Promise.all([
        KeepAwake.activateKeepAwakeAsync(first),
        KeepAwake.activateKeepAwakeAsync(second),
      ])
      try {
        if (Platform.OS === "web") {
          subscription = KeepAwake.addListener(second, () => {
            state.secondReleases += 1
          })
        }
        await KeepAwake.deactivateKeepAwake(first)
        await delay(50)
        if (releaseCount() !== 0) {
          throw new Error("Releasing the first tag also released the second tag")
        }
        await KeepAwake.deactivateKeepAwake(second)
        if (Platform.OS === "web") {
          await withTimeout(
            (async () => {
              while (releaseCount() === 0) await delay(10)
            })(),
            "the concurrent tag release event",
          )
          if (releaseCount() !== 1) {
            throw new Error(`Expected one second-tag release, received ${releaseCount()}`)
          }
        }
      } finally {
        subscription?.remove()
        await Promise.all([cleanupTag(first), cleanupTag(second)])
      }
    })
  })
}
