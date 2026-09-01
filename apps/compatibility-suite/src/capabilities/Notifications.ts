import { Notifications } from "@better-native/notifications"
import * as NotificationBackground from "@better-native/notifications/background"
import { TaskManager } from "@better-native/task-manager"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as ExpoNotifications from "expo-notifications"
import * as ExpoTaskManager from "expo-task-manager"
import { Platform } from "react-native"

export const name = "Notifications Effect capability"

interface JasmineApi {
  readonly describe: (name: string, spec: () => void) => void
  readonly it: (name: string, spec: () => Promise<void>) => void
}

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const AppLive = Layer.merge(Notifications.live, TaskManager.live)
const runtime = ManagedRuntime.make(AppLive)
const taskName = "better-native-notifications-capability"

/** Both definitions intentionally run while the application bundle initializes. */
Notifications.setNotificationHandler(runtime, {
  handleNotification: () =>
    Effect.succeed({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
})
const backgroundDefinition = NotificationBackground.defineBackgroundNotificationTask(
  taskName,
  runtime,
  () => Effect.succeed(Notifications.BackgroundNotificationTaskResult.NoData),
)

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- compatibility entry point
  Effect.runPromise(effect.pipe(Effect.provide(AppLive)) as Effect.Effect<A, E>)

const assertTypedFailure = (exit: Exit.Exit<unknown, unknown>, label: string): void => {
  if (exit._tag === "Success") return
  const reason = exit.cause.reasons[0]
  assert(reason !== undefined && Cause.isFailReason(reason), `${label} failure was not typed`)
  assert(
    reason.error instanceof Notifications.NotificationsUnavailable ||
      reason.error instanceof Notifications.NotificationsFailure,
    `${label} escaped the Notifications error channel`,
  )
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  )
}

export function test({ describe, it }: JasmineApi): void {
  describe(name, () => {
    it("matches raw Expo permission and last-response reads", async () => {
      const [permission, rawPermission, response, rawResponse] = await Promise.all([
        run(Notifications.getPermissionsAsync),
        ExpoNotifications.getPermissionsAsync(),
        run(Effect.exit(Notifications.getLastNotificationResponseAsync)),
        ExpoNotifications.getLastNotificationResponseAsync().then(
          (value) => ({ _tag: "Success" as const, value }),
          (error: unknown) => ({
            _tag: "Failure" as const,
            code:
              typeof error === "object" && error !== null && "code" in error
                ? String(error.code)
                : null,
          }),
        ),
      ])
      assert(
        JSON.stringify(canonical(permission)) === JSON.stringify(canonical(rawPermission)),
        "permissions diverged",
      )
      if (response._tag === "Success" && rawResponse._tag === "Success") {
        assert(
          JSON.stringify(response.value) === JSON.stringify(rawResponse.value),
          "last response diverged",
        )
      } else {
        assert(response._tag === "Failure", "Effect last response unexpectedly succeeded")
        assert(rawResponse._tag === "Failure", "raw last response unexpectedly succeeded")
        assert(rawResponse.code === "ERR_UNAVAILABLE", "raw failure was not unavailable")
        assertTypedFailure(response, "last response")
      }
    })

    it("schedules, inspects, and cancels a local notification or returns a typed platform failure", async () => {
      const outcome = await run(
        Effect.exit(
          Effect.gen(function* () {
            const identifier = yield* Notifications.scheduleNotificationAsync({
              content: { title: "Better Native capability" },
              trigger: {
                type: Notifications.SchedulableTriggerInputTypes.DATE,
                date: new Date(Date.now() + 60_000),
              },
            })
            const scheduled = yield* Notifications.getAllScheduledNotificationsAsync
            const rawScheduled = yield* Effect.tryPromise(() =>
              ExpoNotifications.getAllScheduledNotificationsAsync(),
            )
            yield* Notifications.cancelScheduledNotificationAsync(identifier)
            return {
              rawIdentifiers: rawScheduled.map((request) => request.identifier).sort(),
              effectIdentifiers: scheduled.map((request) => request.identifier).sort(),
            }
          }),
        ),
      )
      assertTypedFailure(outcome, "local scheduling")
      if (outcome._tag === "Success") {
        assert(
          JSON.stringify(outcome.value.effectIdentifiers) ===
            JSON.stringify(outcome.value.rawIdentifiers),
          "raw and Effect scheduled notification lists diverged",
        )
      }
    })

    it("acquires and interrupts every scoped event Stream", async () => {
      const streams: ReadonlyArray<
        Stream.Stream<unknown, Notifications.NotificationsError, Notifications.Notifications>
      > = [
        Notifications.addNotificationReceivedListener,
        Notifications.addNotificationResponseReceivedListener,
        Notifications.addNotificationResponseClearedListener,
        Notifications.addNotificationsDroppedListener,
        Notifications.addPushTokenListener,
      ] as const
      for (const stream of streams) {
        const exit = await run(
          Effect.scoped(
            Effect.gen(function* () {
              const fiber = yield* Stream.runDrain(stream).pipe(Effect.forkScoped)
              yield* Effect.sleep("10 millis")
              yield* Fiber.interrupt(fiber)
            }),
          ).pipe(Effect.exit),
        )
        assertTypedFailure(exit, "notification listener")
      }
    })

    it("hydrates and releases the last-response Atom", async () => {
      const registry = AtomRegistry.make()
      const release = registry.mount(Notifications.lastNotificationResponseAtom)
      try {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          if (!AsyncResult.isInitial(registry.get(Notifications.lastNotificationResponseAtom))) {
            return
          }
          await Effect.runPromise(Effect.sleep("20 millis"))
        }
        throw new Error("last-response Atom did not leave its initial state")
      } finally {
        release()
      }
    })

    it("defines and persistently registers the background handler before route mount", async () => {
      assert(backgroundDefinition.name === taskName, "background definition token drifted")
      try {
        const outcome = await run(
          Effect.exit(NotificationBackground.registerBackgroundTask(backgroundDefinition)),
        )
        assertTypedFailure(outcome, "background registration")
        if (outcome._tag === "Success" && Platform.OS !== "web") {
          assert(
            await ExpoTaskManager.isTaskRegisteredAsync(taskName),
            "Expo did not observe the Effect background registration",
          )
        }
      } finally {
        await run(Notifications.unregisterTaskAsync(taskName).pipe(Effect.ignore))
      }
    })
  })
}
