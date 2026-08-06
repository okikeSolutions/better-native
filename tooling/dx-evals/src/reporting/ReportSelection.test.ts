import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Domain from "../Domain.ts"
import * as ReportSelection from "./ReportSelection.ts"

const artifacts = [
  {
    runId: Domain.RunId.make("campaign-a-old"),
    reportPath: "/reports/a-old.json",
    modifiedAtMilliseconds: 1,
  },
  {
    runId: Domain.RunId.make("campaign-b-new"),
    reportPath: "/reports/b-new.json",
    modifiedAtMilliseconds: 3,
  },
  {
    runId: Domain.RunId.make("campaign-a-new"),
    reportPath: "/reports/a-new.json",
    modifiedAtMilliseconds: 2,
  },
] as const

describe("report selection", () => {
  it.effect("defaults to only the latest retained report", () =>
    Effect.gen(function* () {
      const scope = yield* ReportSelection.resolveScope({
        latest: false,
        campaign: Option.none(),
        all: false,
      })
      const selected = yield* ReportSelection.select(artifacts, scope)
      assert.deepStrictEqual(
        selected.map(({ reportPath }) => reportPath),
        ["/reports/b-new.json"],
      )
    }),
  )

  it.effect("selects only reports belonging to one campaign", () =>
    Effect.gen(function* () {
      const selected = yield* ReportSelection.select(artifacts, {
        kind: "campaign",
        campaignId: Domain.CampaignId.make("campaign-a"),
      })
      assert.deepStrictEqual(
        selected.map(({ reportPath }) => reportPath),
        ["/reports/a-new.json", "/reports/a-old.json"],
      )
    }),
  )

  it.effect("requires --all before historical campaigns are aggregated", () =>
    Effect.gen(function* () {
      const selected = yield* ReportSelection.select(artifacts, { kind: "all" })
      assert.strictEqual(selected.length, 3)
    }),
  )

  it.effect("rejects conflicting scope flags", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        ReportSelection.resolveScope({
          latest: true,
          campaign: Option.some("campaign-a"),
          all: false,
        }),
      )
      assert.strictEqual(exit._tag, "Failure")
    }),
  )
})
