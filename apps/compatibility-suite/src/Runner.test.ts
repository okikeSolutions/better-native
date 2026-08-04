import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import { CompatibilityConfiguration } from "./Configuration.ts"
import { configureUpstreamSelection, metadata, registry, type RegistryEntry } from "./Registry.ts"
import { make, recordJasmineCompletion, RunSelectionError, type CaseResult } from "./Runner.ts"

const tools = { setPortalChild: () => undefined, cleanupPortal: () => Promise.resolve() }
const selection = (sourceId: string) => ({
  schemaVersion: 1,
  runId: "test-run",
  sourceId,
})

const configuration = Layer.succeed(
  CompatibilityConfiguration,
  CompatibilityConfiguration.of({ mode: "candidate", buildId: "test-build" }),
)

configureUpstreamSelection(
  metadata.sources.flatMap(({ runtimeName }) => (runtimeName === null ? [] : [runtimeName])),
)

const basic = registry.find(({ path }) => path.endsWith("/tests/Basic.js"))
if (basic === undefined) throw new Error("Basic registry source is missing")
const basicCase = basic.caseIds[0]
if (basicCase === undefined) throw new Error("Basic registry case is missing")
const battery = registry.find(({ path }) => path.endsWith("/tests/Battery.js"))
if (battery === undefined) throw new Error("Battery registry source is missing")
const network = registry.find(({ path }) => path.endsWith("/tests/Network.js"))
if (network === undefined) throw new Error("Network registry source is missing")

const outcomeTag = (outcome: CaseResult["outcome"]): string =>
  Match.value(outcome).pipe(
    Match.tagsExhaustive({
      passed: () => "passed",
      failed: () => "failed",
      skipped: () => "skipped",
      "not-run": () => "not-run",
    }),
  )

describe("compatibility runner", () => {
  it.effect("executes Expo Jasmine cases under their stable catalog IDs", () => {
    const arithmeticCase = basic.caseIds.find((caseId) => caseId.includes("2 + 2 is 4?"))
    if (arithmeticCase === undefined) throw new Error("Basic arithmetic case is missing")
    // Registry loaders use a Metro-only alias for the external Expo checkout. The runner unit
    // test verifies the stable catalog contract with a deterministic module; Metro integration
    // tests exercise that alias against the real Expo source.
    const source: RegistryEntry = {
      ...basic,
      load: () => ({
        name: "Basic",
        test: (jasmine: {
          describe: (name: string, body: () => void) => void
          it: (name: string, body: () => void) => void
          expect: (value: unknown) => { toBe: (expected: unknown) => void }
        }) => {
          jasmine.describe("Basic", () => {
            jasmine.it("2 + 2 is 4?", () => jasmine.expect(2 + 2).toBe(4))
          })
        },
      }),
    }
    return make([source])
      .run(selection(basic.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          const result = summary.results.find(({ caseId }) => caseId === arithmeticCase)
          assert.isDefined(result)
          assert.deepEqual(summary.runtimeDiscoveredCaseIds, [arithmeticCase])
          assert.strictEqual(result.caseId, arithmeticCase)
          assert.strictEqual(outcomeTag(result.outcome), "passed")
        }),
      )
  })

  it.effect("rejects malformed and unknown source selections", () =>
    Effect.gen(function* () {
      const runner = make([basic])
      for (const input of [
        { schemaVersion: 1, runId: "", sourceId: basic.sourceId },
        selection("missing#source"),
      ]) {
        const error = yield* runner.decodeRunSelection(input).pipe(Effect.flip)
        assert.instanceOf(error, RunSelectionError)
      }
    }),
  )

  it.effect("runs Basic, Battery, and Network together in the interactive smoke cohort", () => {
    const sources = [basic, battery, network].map(
      (entry): RegistryEntry => ({
        ...entry,
        load: () => ({
          name: entry.runtimeName ?? entry.path,
          test: (jasmine: {
            describe: (name: string, body: () => void) => void
            it: (name: string, body: () => void) => void
          }) => {
            jasmine.describe(entry.runtimeName ?? entry.path, () => {
              jasmine.it("runs", () => undefined)
            })
          },
        }),
      }),
    )
    return make(sources)
      .run({ schemaVersion: 1, runId: "smoke-run", cohort: "interactive-smoke" }, tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.lengthOf(summary.results, 3)
          assert.isTrue(summary.results.every(({ outcome }) => outcome._tag === "passed"))
          assert.isTrue(
            sources.every(({ sourceId }) =>
              summary.results.some(({ caseId }) => caseId.startsWith(`${sourceId}#`)),
            ),
          )
        }),
      )
  })

  it.effect("runs the curated native E2E cohort without changing its membership", () => {
    const source: RegistryEntry = {
      ...basic,
      load: () => ({
        name: "Basic",
        test: (jasmine: {
          describe: (name: string, body: () => void) => void
          it: (name: string, body: () => void) => void
        }) => {
          jasmine.describe("Basic", () => {
            jasmine.it("runs", () => undefined)
          })
        },
      }),
    }
    return make([source])
      .run({ schemaVersion: 1, runId: "native-e2e-run", cohort: "native-e2e" }, tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.lengthOf(summary.results, 1)
          assert.strictEqual(summary.results[0]?.outcome._tag, "passed")
        }),
      )
  })

  it.effect("rejects an empty native E2E cohort", () =>
    make([battery])
      .run({ schemaVersion: 1, runId: "empty-native-e2e", cohort: "native-e2e" }, tools)
      .pipe(
        Effect.provide(configuration),
        Effect.flip,
        Effect.map((error) => {
          assert.instanceOf(error, RunSelectionError)
          assert.match(error.reason, /native-e2e cohort is empty/)
        }),
      ),
  )

  it.effect("rejects an empty interactive smoke cohort", () => {
    const source: RegistryEntry = {
      ...basic,
      sourceId: "expo-app-suite#apps/test-suite/tests/NotInInteractiveSmoke.js",
    }
    return make([source])
      .run(
        { schemaVersion: 1, runId: "empty-interactive-smoke", cohort: "interactive-smoke" },
        tools,
      )
      .pipe(
        Effect.provide(configuration),
        Effect.flip,
        Effect.map((error) => {
          assert.instanceOf(error, RunSelectionError)
          assert.match(error.reason, /interactive-smoke cohort is empty/)
        }),
      )
  })

  it.effect("skips a source omitted by the pinned Expo applicability selection", () => {
    const source: RegistryEntry = {
      ...basic,
      get selectedByUpstream(): boolean {
        return false
      },
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.strictEqual(summary.results.length, source.caseIds.length)
          assert.isTrue(summary.results.every(({ outcome }) => outcome._tag === "skipped"))
          assert.match(JSON.stringify(summary), /not selected by pinned Expo TestModules/)
        }),
      )
  })

  it.effect(
    "uses the not-applicable fallback for an unselected source without static cases",
    () => {
      const source: RegistryEntry = {
        ...basic,
        caseIds: [],
        get selectedByUpstream() {
          return false
        },
      }
      return make([source])
        .run(selection(source.sourceId), tools)
        .pipe(
          Effect.provide(configuration),
          Effect.map((summary) => {
            assert.deepEqual(
              summary.results.map(({ caseId }) => caseId),
              [`${source.sourceId}#<not-applicable>@1`],
            )
            assert.deepEqual(summary.runtimeDiscoveredCaseIds, [
              `${source.sourceId}#<not-applicable>@1`,
            ])
          }),
        )
    },
  )

  it.effect("marks a missing app loader as not-run", () => {
    const source: RegistryEntry = {
      ...basic,
      load: null,
      reason: "source is external to the application",
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.isTrue(summary.results.every(({ outcome }) => outcome._tag === "not-run"))
          assert.match(JSON.stringify(summary), /source is external to the application/)
        }),
      )
  })

  it.effect("uses the default reason for a missing app loader", () => {
    const source: RegistryEntry = {
      ...basic,
      load: null,
      reason: null,
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.match(JSON.stringify(summary), /source is external to the application/)
        }),
      )
  })

  it.effect("rejects a loaded module that is not an Expo Jasmine module", () => {
    const source: RegistryEntry = {
      ...basic,
      load: () => ({ name: "missing test function" }),
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.isTrue(summary.results.every(({ outcome }) => outcome._tag === "failed"))
          assert.match(JSON.stringify(summary), /is not an Expo Jasmine module/)
        }),
      )
  })

  it.effect("turns a missing module into an explicit failed case", () => {
    const source: RegistryEntry = {
      ...basic,
      load: () => {
        throw new Error("injected missing module")
      },
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          const result = summary.results[0]
          assert.isDefined(result)
          assert.strictEqual(outcomeTag(result.outcome), "failed")
          assert.match(JSON.stringify(summary.results[0]), /injected missing module/)
        }),
      )
  })

  it.effect("records a non-Error loader failure without inventing a stack", () => {
    const source: RegistryEntry = {
      ...basic,
      load: () => {
        throw "injected non-Error failure"
      },
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          const outcome = summary.results[0]?.outcome
          assert.isDefined(outcome)
          assert.strictEqual(outcome._tag, "failed")
          if (outcome._tag === "failed") {
            assert.strictEqual(outcome.message, "injected non-Error failure")
            assert.strictEqual(outcome.stack, null)
          }
        }),
      )
  })

  it.effect("skips a source that registers no cases for the current platform", () => {
    const source: RegistryEntry = {
      ...basic,
      load: () => ({
        name: "Platform-specific empty source",
        test: (jasmine: { describe: (name: string, body: () => void) => void }) => {
          jasmine.describe("FileSystem (legacy)", () => undefined)
        },
      }),
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.strictEqual(summary.results.length, source.caseIds.length)
          assert.isTrue(summary.results.every(({ outcome }) => outcome._tag === "skipped"))
          assert.match(JSON.stringify(summary), /registered no cases for this platform/)
        }),
      )
  })

  it.effect("wraps unexpected source execution errors with the selected source ID", () => {
    const source: RegistryEntry = {
      ...basic,
      get selectedByUpstream(): boolean {
        throw new Error("applicability adapter failed")
      },
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.flip,
        Effect.map((error) => {
          assert.instanceOf(error, RunSelectionError)
          assert.include(
            error.reason,
            `execute ${source.sourceId}: Error: applicability adapter failed`,
          )
        }),
      )
  })

  it.effect("uses runtime registration as the platform-specific case denominator", () => {
    const firstCase = basic.caseIds[0]
    const secondCase = basic.caseIds[1]
    if (firstCase === undefined || secondCase === undefined) {
      throw new Error("Basic registry needs at least two cases")
    }
    const source: RegistryEntry = {
      ...basic,
      caseIds: [firstCase, secondCase],
      load: () => ({
        name: "Platform-conditioned source",
        test: (jasmine: {
          describe: (name: string, body: () => void) => void
          it: (name: string, body: () => void) => void
        }) => {
          jasmine.describe("Basic", () => {
            jasmine.it("2 + 2 is 4?", () => undefined)
          })
        },
      }),
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.deepEqual(summary.runtimeDiscoveredCaseIds, [firstCase])
          assert.deepEqual(
            summary.results.map(({ caseId }) => caseId),
            [firstCase],
          )
          assert.isFalse(summary.results.some(({ outcome }) => outcome._tag === "not-run"))
        }),
      )
  })

  it.effect("records a registration exception as failed source results", () => {
    const source: RegistryEntry = {
      ...basic,
      load: () => ({
        name: "Broken registration",
        test: () => {
          throw new Error("injected registration failure")
        },
      }),
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.isTrue(summary.results.every(({ outcome }) => outcome._tag === "failed"))
          assert.match(JSON.stringify(summary), /injected registration failure/)
        }),
      )
  })

  it.effect("uses a registration-failure fallback when static cases are unavailable", () => {
    const source: RegistryEntry = {
      ...basic,
      caseIds: [],
      load: () => ({
        name: "Broken registration",
        test: () => {
          throw new Error("injected empty registration failure")
        },
      }),
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.deepEqual(
            summary.results.map(({ caseId }) => caseId),
            [`${source.sourceId}#<registration failure>@1`],
          )
          assert.deepEqual(summary.runtimeDiscoveredCaseIds, [
            `${source.sourceId}#<registration failure>@1`,
          ])
        }),
      )
  })

  it.effect("uses a platform-skip fallback when no static cases are registered", () => {
    const source: RegistryEntry = {
      ...basic,
      caseIds: [],
      load: () => ({ name: "No cases", test: () => undefined }),
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.deepEqual(
            summary.results.map(({ caseId }) => caseId),
            [`${source.sourceId}#<not-applicable>@1`],
          )
          assert.deepEqual(summary.runtimeDiscoveredCaseIds, [
            `${source.sourceId}#<not-applicable>@1`,
          ])
        }),
      )
  })

  it.effect("assigns the first occurrence to a static case ID without an occurrence suffix", () => {
    const sourceId = "expo-app-suite#apps/test-suite/tests/NoOccurrence.ts"
    const caseId = `${sourceId}#No occurrence runs`
    const source: RegistryEntry = {
      ...basic,
      sourceId,
      path: "apps/test-suite/tests/NoOccurrence.ts",
      caseIds: [caseId],
      load: () => ({
        name: "No occurrence",
        test: (jasmine: {
          describe: (name: string, body: () => void) => void
          it: (name: string, body: () => void) => void
        }) => {
          jasmine.describe("No occurrence", () => {
            jasmine.it("runs", () => undefined)
          })
        },
      }),
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => assert.deepEqual(summary.runtimeDiscoveredCaseIds, [caseId])),
      )
  })

  it.effect("reports runtime-only cases without inventing absent static cases", () => {
    const source: RegistryEntry = {
      ...basic,
      load: () => ({
        name: "Injected",
        test: (jasmine: unknown) => {
          if (typeof jasmine !== "object" || jasmine === null) {
            throw new Error("invalid Jasmine interface")
          }
          const describeCase = "describe" in jasmine ? jasmine.describe : undefined
          const registerCase = "it" in jasmine ? jasmine.it : undefined
          if (typeof describeCase !== "function" || typeof registerCase !== "function") {
            throw new Error("invalid Jasmine interface")
          }
          describeCase("Different suite", () => {
            registerCase("different case", () => undefined)
          })
        },
      }),
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.lengthOf(summary.results, 1)
          const discovered = summary.results[0]
          assert.isDefined(discovered)
          assert.strictEqual(outcomeTag(discovered.outcome), "passed")
          assert.deepEqual(summary.runtimeDiscoveredCaseIds, [discovered.caseId])
          assert.notStrictEqual(discovered.caseId, basicCase)
        }),
      )
  })

  it.effect(
    "selects duplicate Jasmine names by occurrence and wraps unused async parameters",
    () => {
      const sourceId = "expo-app-suite#apps/test-suite/tests/Injected.ts"
      const first = `${sourceId}#Injected duplicate@1`
      const second = `${sourceId}#Injected duplicate@2`
      const source: RegistryEntry = {
        ...basic,
        sourceId,
        path: "apps/test-suite/tests/Injected.ts",
        caseIds: [first, second],
        load: () => ({
          name: "Injected",
          test: (jasmine: {
            describe: (name: string, body: () => void) => void
            it: (name: string, body: (unused: unknown) => Promise<void>) => void
          }) => {
            jasmine.describe("Injected", () => {
              jasmine.it("duplicate", async (_unused) => {
                throw new Error("the unselected first occurrence ran")
              })
              jasmine.it("duplicate", async (_unused) => Promise.resolve())
            })
          },
        }),
      }
      return make([source])
        .run(selection(source.sourceId), tools)
        .pipe(
          Effect.provide(configuration),
          Effect.map((summary) => {
            assert.strictEqual(summary.results.length, 2)
            assert.strictEqual(
              summary.results.find(({ caseId }) => caseId === first)?.outcome._tag,
              "failed",
            )
            assert.strictEqual(
              summary.results.find(({ caseId }) => caseId === second)?.outcome._tag,
              "passed",
            )
          }),
        )
    },
  )

  it.effect("surfaces a Jasmine suite-level failure as a failed case", () => {
    const source: RegistryEntry = {
      ...basic,
      load: () => ({
        name: "Injected",
        test: (jasmine: {
          describe: (name: string, body: () => void) => void
          it: (name: string, body: () => void) => void
          afterAll: (body: () => void) => void
        }) => {
          jasmine.describe("Basic", () => {
            jasmine.it("2 + 2 is 4?", () => undefined)
            jasmine.afterAll(() => {
              throw new Error("suite cleanup failed")
            })
          })
        },
      }),
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.strictEqual(summary.results[0]?.outcome._tag, "failed")
          assert.match(JSON.stringify(summary), /Jasmine completed with status failed/)
        }),
      )
  })

  it.effect("records non-passing Jasmine statuses as skipped outcomes", () => {
    const source: RegistryEntry = {
      ...basic,
      load: () => ({
        name: "Pending",
        test: (jasmine: {
          describe: (name: string, body: () => void) => void
          xit: (name: string, body: () => void) => void
        }) => {
          jasmine.describe("Pending", () => {
            jasmine.xit("is intentionally skipped", () => undefined)
          })
        },
      }),
    }
    return make([source])
      .run(selection(source.sourceId), tools)
      .pipe(
        Effect.provide(configuration),
        Effect.map((summary) => {
          assert.lengthOf(summary.results, 1)
          assert.strictEqual(summary.results[0]?.outcome._tag, "skipped")
        }),
      )
  })

  it("records a terminal Jasmine failure when no spec result is reported", () => {
    const results: Array<CaseResult> = []
    const runtimeDiscoveredCaseIds: Array<string> = []
    recordJasmineCompletion({
      done: { overallStatus: "failed" },
      results,
      selectedCaseIds: new Set(),
      sourceId: basic.sourceId,
      runId: "terminal-failure",
      runtimeDiscoveredCaseIds,
    })
    assert.deepEqual(
      results.map(({ caseId }) => caseId),
      [`${basic.sourceId}#<suite failure>@1`],
    )
    assert.deepEqual(runtimeDiscoveredCaseIds, [`${basic.sourceId}#<suite failure>@1`])
    assert.match(JSON.stringify(results), /Jasmine completed with status failed/)
  })

  it("prefers the incomplete reason and selected case for a terminal Jasmine failure", () => {
    const results: Array<CaseResult> = []
    const runtimeDiscoveredCaseIds: Array<string> = []
    recordJasmineCompletion({
      done: { overallStatus: "incomplete", incompleteReason: "native runner stopped" },
      results,
      selectedCaseIds: new Set([basicCase]),
      sourceId: basic.sourceId,
      runId: "incomplete-run",
      runtimeDiscoveredCaseIds,
    })
    const outcome = results[0]?.outcome
    assert.isDefined(outcome)
    assert.strictEqual(outcome._tag, "failed")
    if (outcome._tag === "failed") assert.strictEqual(outcome.message, "native runner stopped")
    assert.deepEqual(runtimeDiscoveredCaseIds, [])
  })
})
