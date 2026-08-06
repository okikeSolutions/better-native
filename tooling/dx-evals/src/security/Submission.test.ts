import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Domain from "../Domain.ts"
import { validateSubmission } from "./Submission.ts"

const policy = {
  allowedPaths: new Set([Domain.TaskRelativePath.make("src/Greeting.ts")]),
  maxFiles: 1,
  maxFileBytes: 128,
  maxTotalBytes: 128,
}

describe("submission validation", () => {
  it.effect("accepts one allowlisted regular file", () =>
    Effect.gen(function* () {
      const submission = {
        entries: [{ kind: "file" as const, path: "src/Greeting.ts", content: "ok" }],
      }
      const validated = yield* validateSubmission(submission, policy)
      assert.strictEqual(validated.entries[0]?.path, submission.entries[0]?.path)
    }),
  )

  for (const [name, entry] of [
    ["path traversal", { kind: "file", path: "../grader/expected.json", content: "x" }],
    ["withheld path", { kind: "file", path: "grader/expected.json", content: "x" }],
    ["symlink", { kind: "symlink", path: "src/Greeting.ts", content: "/etc/passwd" }],
    ["hardlink", { kind: "hardlink", path: "src/Greeting.ts", content: "outside" }],
    ["special file", { kind: "special", path: "src/Greeting.ts", content: "device" }],
  ] as const) {
    it.effect(`rejects ${name}`, () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(validateSubmission({ entries: [entry] }, policy))
        assert.strictEqual(exit._tag, "Failure")
      }),
    )
  }

  it.effect("rejects case-folded collisions and excessive content", () =>
    Effect.gen(function* () {
      const collision = yield* Effect.exit(
        validateSubmission(
          {
            entries: [
              { kind: "file", path: "src/Greeting.ts", content: "a" },
              { kind: "file", path: "src/greeting.ts", content: "b" },
            ],
          },
          {
            ...policy,
            allowedPaths: new Set([
              Domain.TaskRelativePath.make("src/Greeting.ts"),
              Domain.TaskRelativePath.make("src/greeting.ts"),
            ]),
            maxFiles: 2,
          },
        ),
      )
      const oversized = yield* Effect.exit(
        validateSubmission(
          { entries: [{ kind: "file", path: "src/Greeting.ts", content: "x".repeat(129) }] },
          policy,
        ),
      )
      assert.strictEqual(collision._tag, "Failure")
      assert.strictEqual(oversized._tag, "Failure")
    }),
  )
})
