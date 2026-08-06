import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import * as WorkspaceInspection from "./VirtualWorkspace.ts"

const files = new Map([
  ["src/example.ts", "first\nsecond match\nthird\nfourth match\nfifth\n"],
  [
    "node_modules/effect/dist/Effect.d.ts",
    "export const matchEffect = 1\nexport const provide = 2\n",
  ],
])

describe("bounded workspace inspection", () => {
  it("owns validated request, result, and reviewed-limit schemas", () => {
    const limits = Schema.decodeUnknownSync(WorkspaceInspection.Limits)({
      ...WorkspaceInspection.defaultLimits,
      maximumReadLines: 1,
      maximumPathResults: 1,
      defaultListResults: 1,
    })
    const read = WorkspaceInspection.read(files, { path: "src/example.ts" }, limits)
    const paths = WorkspaceInspection.list(files, {}, limits)

    assert.isTrue(Schema.is(WorkspaceInspection.ReadResult)(read))
    assert.isTrue(Schema.is(WorkspaceInspection.PathResult)(paths))
    assert.isFalse(
      Schema.is(WorkspaceInspection.ReadResult)({
        ok: false,
        error: "arbitrary-error",
      }),
    )
    assert.deepStrictEqual(read, {
      ok: true,
      content: "first",
      startLine: 1,
      endLine: 1,
      totalLines: 5,
      truncated: true,
      nextOffset: 2,
    })
    assert.deepStrictEqual(paths, {
      ok: true,
      paths: ["node_modules/"],
      truncated: true,
    })
    assert.strictEqual(
      Schema.decodeUnknownOption(WorkspaceInspection.Limits)({
        ...WorkspaceInspection.defaultLimits,
        maximumPathResults: 1,
        defaultListResults: 2,
      })._tag,
      "None",
    )
  })

  it("lists directories and finds files without exposing paths outside the virtual workspace", () => {
    assert.deepStrictEqual(WorkspaceInspection.list(files, {}), {
      ok: true,
      paths: ["node_modules/", "src/"],
      truncated: false,
    })
    assert.deepStrictEqual(
      WorkspaceInspection.find(files, {
        path: "node_modules",
        pattern: "**/*.d.ts",
      }),
      {
        ok: true,
        paths: ["node_modules/effect/dist/Effect.d.ts"],
        truncated: false,
      },
    )
    assert.deepStrictEqual(WorkspaceInspection.list(files, { path: "../grader" }), {
      ok: false,
      error: "unsafe-path",
    })
  })

  it("treats explicit null optional inspection arguments as omitted", () => {
    const listRequest = Schema.decodeUnknownSync(WorkspaceInspection.ListRequest)({
      path: null,
      limit: null,
    })
    const findRequest = Schema.decodeUnknownSync(WorkspaceInspection.FindRequest)({
      pattern: "**/*.ts",
      path: null,
      limit: null,
    })
    const searchRequest = Schema.decodeUnknownSync(WorkspaceInspection.SearchRequest)({
      pattern: "match",
      path: null,
      ignoreCase: null,
      literal: null,
      glob: null,
      context: null,
      limit: null,
    })

    assert.deepStrictEqual(
      WorkspaceInspection.list(files, listRequest),
      WorkspaceInspection.list(files, {}),
    )
    assert.deepStrictEqual(
      WorkspaceInspection.find(files, findRequest),
      WorkspaceInspection.find(files, { pattern: "**/*.ts" }),
    )
    assert.deepStrictEqual(
      WorkspaceInspection.search(files, searchRequest),
      WorkspaceInspection.search(files, { pattern: "match" }),
    )
  })

  it("reads complete small files with line metadata", () => {
    assert.deepStrictEqual(WorkspaceInspection.read(files, { path: "src/example.ts" }), {
      ok: true,
      content: "first\nsecond match\nthird\nfourth match\nfifth",
      startLine: 1,
      endLine: 5,
      totalLines: 5,
      truncated: false,
    })
  })

  it("continues large files by offset without exceeding the line limit", () => {
    const largeFiles = new Map([
      ["large.d.ts", Array.from({ length: 2_005 }, (_, i) => `line ${i + 1}`).join("\n")],
    ])
    const first = WorkspaceInspection.read(largeFiles, { path: "large.d.ts" })
    const remainder = WorkspaceInspection.read(largeFiles, {
      path: "large.d.ts",
      offset: 2_001,
    })

    assert.strictEqual(first.ok, true)
    if (first.ok) {
      assert.strictEqual(first.endLine, 2_000)
      assert.strictEqual(first.nextOffset, 2_001)
      assert.isTrue(first.truncated)
    }
    assert.deepStrictEqual(remainder, {
      ok: true,
      content: "line 2001\nline 2002\nline 2003\nline 2004\nline 2005",
      startLine: 2_001,
      endLine: 2_005,
      totalLines: 2_005,
      truncated: false,
    })
  })

  it("applies the byte ceiling only at complete-line boundaries", () => {
    const line = "x".repeat(1_024)
    const result = WorkspaceInspection.read(
      new Map([["large.d.ts", Array(60).fill(line).join("\n")]]),
      {
        path: "large.d.ts",
      },
    )

    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.isBelow(new TextEncoder().encode(result.content).byteLength, 50 * 1_024 + 1)
      assert.isTrue(result.truncated)
      assert.strictEqual(result.nextOffset, result.endLine + 1)
    }
  })

  it("represents an empty file without inventing a line", () => {
    assert.deepStrictEqual(
      WorkspaceInspection.read(new Map([["empty.ts", ""]]), {
        path: "empty.ts",
      }),
      {
        ok: true,
        content: "",
        startLine: 1,
        endLine: 0,
        totalLines: 0,
        truncated: false,
      },
    )
  })

  it("rejects invalid or unavailable read windows", () => {
    const explicitNull = Schema.decodeUnknownSync(WorkspaceInspection.ReadRequest)({
      path: "src/example.ts",
      offset: null,
      limit: null,
    })
    assert.deepStrictEqual(
      WorkspaceInspection.read(files, explicitNull),
      WorkspaceInspection.read(files, { path: "src/example.ts" }),
    )
    const fractional = Schema.decodeUnknownSync(WorkspaceInspection.ReadRequest)({
      path: "src/example.ts",
      offset: 1.5,
    })
    assert.deepStrictEqual(WorkspaceInspection.read(files, fractional), {
      ok: false,
      error: "invalid-offset",
    })
    assert.deepStrictEqual(WorkspaceInspection.read(files, { path: "missing.ts" }), {
      ok: false,
      error: "file-not-found",
    })
    assert.deepStrictEqual(WorkspaceInspection.read(files, { path: "src/example.ts", offset: 0 }), {
      ok: false,
      error: "invalid-offset",
    })
    assert.deepStrictEqual(
      WorkspaceInspection.read(files, { path: "src/example.ts", offset: 99 }),
      {
        ok: false,
        error: "offset-out-of-bounds",
      },
    )
    assert.deepStrictEqual(
      WorkspaceInspection.read(new Map([["one-line.ts", "x".repeat(60 * 1_024)]]), {
        path: "one-line.ts",
      }),
      { ok: false, error: "line-size-limit" },
    )
  })

  it("searches exact files with bounded context and line numbers", () => {
    assert.deepStrictEqual(
      WorkspaceInspection.search(files, {
        path: "src/example.ts",
        pattern: "match",
        context: 1,
      }),
      {
        ok: true,
        matches: [
          {
            path: "src/example.ts",
            line: 2,
            content: "1: first\n2: second match\n3: third",
          },
          {
            path: "src/example.ts",
            line: 4,
            content: "3: third\n4: fourth match\n5: fifth",
          },
        ],
        truncated: false,
        searchedFiles: 1,
      },
    )
  })

  it("searches directory prefixes and reports match truncation", () => {
    const result = WorkspaceInspection.search(files, {
      path: "node_modules/effect",
      pattern: "EXPORT CONST",
      ignoreCase: true,
      limit: 1,
    })

    assert.deepStrictEqual(result, {
      ok: true,
      matches: [
        {
          path: "node_modules/effect/dist/Effect.d.ts",
          line: 1,
          content: "1: export const matchEffect = 1",
        },
      ],
      truncated: true,
      searchedFiles: 1,
    })
  })

  it("supports regex grep, literal grep, and glob filtering", () => {
    const regex = WorkspaceInspection.search(files, {
      pattern: "match(?:Effect)?",
      glob: "**/*.d.ts",
    })
    const literal = WorkspaceInspection.search(files, {
      pattern: "match(?:Effect)?",
      literal: true,
    })

    assert.strictEqual(regex.ok, true)
    if (regex.ok) assert.strictEqual(regex.matches.length, 1)
    assert.strictEqual(literal.ok, true)
    if (literal.ok) assert.strictEqual(literal.matches.length, 0)
    assert.deepStrictEqual(WorkspaceInspection.search(files, { pattern: "[" }), {
      ok: false,
      error: "invalid-pattern",
    })
  })

  it("applies unique non-overlapping exact edits against the original content", () => {
    assert.deepStrictEqual(
      WorkspaceInspection.edit("one two three", {
        path: "src/example.ts",
        oldText: "two",
        newText: "2",
      }),
      { ok: true, content: "one 2 three", replacements: 1 },
    )
    assert.deepStrictEqual(
      WorkspaceInspection.edit("one two three", {
        path: "src/example.ts",
        edits: [
          { oldText: "one", newText: "1" },
          { oldText: "three", newText: "3" },
        ],
      }),
      { ok: true, content: "1 two 3", replacements: 2 },
    )
    assert.deepStrictEqual(
      WorkspaceInspection.edit("same same", {
        path: "src/example.ts",
        edits: [{ oldText: "same", newText: "changed" }],
      }),
      { ok: false, error: "old-text-not-unique" },
    )
    assert.deepStrictEqual(
      WorkspaceInspection.edit("abcdef", {
        path: "src/example.ts",
        edits: [
          { oldText: "abcd", newText: "x" },
          { oldText: "cdef", newText: "y" },
        ],
      }),
      { ok: false, error: "overlapping-edits" },
    )
  })

  it("bounds large search output and truncates individual lines", () => {
    const result = WorkspaceInspection.search(
      new Map([
        [
          "large.d.ts",
          Array.from({ length: 100 }, (_, index) => `match ${index} ${"x".repeat(1_000)}`).join(
            "\n",
          ),
        ],
      ]),
      { pattern: "match" },
    )

    assert.strictEqual(result.ok, true)
    if (result.ok) {
      assert.isTrue(result.truncated)
      assert.isBelow(
        new TextEncoder().encode(JSON.stringify(result.matches)).byteLength,
        50 * 1_024 + 1,
      )
      assert.isAtMost(result.matches[0]!.content.length, 504)
    }
  })

  it("rejects unsafe search sizes and paths outside the allowlist", () => {
    assert.deepStrictEqual(WorkspaceInspection.search(files, { pattern: "" }), {
      ok: false,
      error: "invalid-pattern",
    })
    assert.deepStrictEqual(WorkspaceInspection.search(files, { pattern: "x", context: 6 }), {
      ok: false,
      error: "invalid-context",
    })
    assert.deepStrictEqual(
      WorkspaceInspection.search(files, {
        pattern: "secret",
        path: "../grader",
      }),
      { ok: false, error: "path-not-found" },
    )
  })
})
