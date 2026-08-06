import * as Context from "effect/Context"
import * as Config from "effect/Config"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Ref from "effect/Ref"
import * as Campaigns from "./Campaigns.ts"
import * as Domain from "../Domain.ts"

/** Conservative in-process campaign budget snapshot. */
export interface Snapshot {
  readonly maximumCostUsd: number
  readonly reservedCostUsd: number
  readonly reservations: Readonly<Record<string, number>>
}

type ReservationResult =
  | { readonly type: "reserved" }
  | { readonly type: "duplicate" }
  | { readonly type: "rejected"; readonly remainingCostUsd: number }

/** Failure raised before a trial whose reservation would exceed the campaign ceiling. */
export class CampaignCostLimitExceeded extends Data.TaggedError("CampaignCostLimitExceeded")<{
  readonly runId: Domain.RunId
  readonly requestedCostUsd: number
  readonly remainingCostUsd: number
}> {}

/** Failure raised when a paid run identity is reused within one controller process. */
export class CampaignRunIdAlreadyReserved extends Data.TaggedError("CampaignRunIdAlreadyReserved")<{
  readonly runId: Domain.RunId
}> {}

/** Process-owned fail-fast budget operations for paid trials. */
export interface Service {
  readonly reserve: (
    runId: Domain.RunId,
    maximumTrialCostUsd: number,
  ) => Effect.Effect<void, CampaignCostLimitExceeded | CampaignRunIdAlreadyReserved>
  readonly settle: (runId: Domain.RunId, actualCostUsd: number) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<Snapshot>
}

/** Effect service preventing an accidentally oversized paid campaign. */
export class CampaignBudget extends Context.Service<CampaignBudget, Service>()(
  "@better-native/dx-evals/CampaignBudget",
) {}

const makeLayer = (maximumCostUsd: number) =>
  Layer.effect(
    CampaignBudget,
    Effect.gen(function* () {
      const reservations = yield* Ref.make(new Map<string, number>())
      const snapshot = Ref.get(reservations).pipe(
        Effect.map((current) => ({
          maximumCostUsd,
          reservedCostUsd: [...current.values()].reduce((total, value) => total + value, 0),
          reservations: Object.fromEntries(current),
        })),
      )
      return CampaignBudget.of({
        reserve: (runId, maximumTrialCostUsd) =>
          Effect.gen(function* () {
            const result = yield* Ref.modify<Map<string, number>, ReservationResult>(
              reservations,
              (current) => {
                if (current.has(runId)) return [{ type: "duplicate" }, current]
                const reservedCostUsd = [...current.values()].reduce(
                  (total, value) => total + value,
                  0,
                )
                const remainingCostUsd = maximumCostUsd - reservedCostUsd
                if (maximumTrialCostUsd > remainingCostUsd) {
                  return [{ type: "rejected", remainingCostUsd }, current]
                }
                const next = new Map(current)
                next.set(runId, maximumTrialCostUsd)
                return [{ type: "reserved" }, next]
              },
            )
            return yield* Match.value(result).pipe(
              Match.when({ type: "reserved" }, () => Effect.void),
              Match.when({ type: "duplicate" }, () =>
                Effect.fail(new CampaignRunIdAlreadyReserved({ runId })),
              ),
              Match.when({ type: "rejected" }, ({ remainingCostUsd }) =>
                Effect.fail(
                  new CampaignCostLimitExceeded({
                    runId,
                    requestedCostUsd: maximumTrialCostUsd,
                    remainingCostUsd,
                  }),
                ),
              ),
              Match.exhaustive,
            )
          }),
        settle: (runId, actualCostUsd) =>
          Ref.update(reservations, (current) => {
            if (!current.has(runId)) return current
            const next = new Map(current)
            next.set(runId, actualCostUsd)
            return next
          }),
        snapshot,
      })
    }),
  )

/** Runtime budget selected by the reviewed campaign CLI, with a safe deterministic default. */
export const layer = Layer.unwrap(
  Config.number("BETTER_NATIVE_EVAL_CAMPAIGN_MAX_COST_USD").pipe(
    Config.withDefault(Campaigns.reviewedMaximumKeyLimitUsd),
    Effect.map(makeLayer),
  ),
)

/** Deterministic custom ceiling used by budget tests. */
export const layerWithMaximum = makeLayer
