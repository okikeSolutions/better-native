import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Domain from "../Domain.ts"
import {
  TaskBundleInvalid,
  validateArchiveListing,
  validatePublicPackageSurface,
} from "./PackageArtifact.ts"
import type * as TaskModel from "./TaskModel.ts"

const spec: TaskModel.PackedPackageSpec = {
  taskName: "example",
  packageDirectory: "example",
  packageName: "@better-native/example",
  nativeDouble: "expo-example",
}

const manifest = JSON.stringify({
  name: "@better-native/example",
  exports: {
    ".": { types: "./build/index.d.ts", import: "./build/index.js" },
    "./expo": { types: "./build/Expo.d.ts", import: "./build/Expo.js" },
  },
})

const validFiles = new Map([
  ["package.json", manifest],
  ["build/index.d.ts", 'export * from "./Public.ts"\n'],
  ["build/Public.d.ts", 'export type { Detail } from "./Detail.js"\n'],
  ["build/Detail.d.ts", "export interface Detail { readonly value: string }\n"],
  ["build/Expo.d.ts", "export declare const layer: unknown\n"],
  ["build/index.js", "export {}\n"],
  ["build/Expo.js", "export {}\n"],
])

const validateFiles = (files: ReadonlyMap<string, string>) =>
  validatePublicPackageSurface(spec, new Set(files.keys()), (relativePath) => {
    const content = files.get(relativePath)
    return content === undefined
      ? Effect.fail(new TaskBundleInvalid({ reason: `missing-test-file:${relativePath}` }))
      : Effect.succeed(content)
  })

describe("packed package validation", () => {
  it.effect("keeps only package metadata and the complete exported declaration graph", () =>
    Effect.gen(function* () {
      const surface = yield* validateFiles(validFiles)
      assert.deepStrictEqual(
        surface.publicFiles.map((file) => file.path),
        [
          Domain.TaskRelativePath.make("package.json"),
          Domain.TaskRelativePath.make("build/Detail.d.ts"),
          Domain.TaskRelativePath.make("build/Expo.d.ts"),
          Domain.TaskRelativePath.make("build/Public.d.ts"),
          Domain.TaskRelativePath.make("build/index.d.ts"),
        ],
      )
      assert.isFalse(surface.publicFiles.some((file) => file.path.endsWith(".js")))
    }),
  )

  it.effect("rejects a missing exported type entrypoint", () =>
    Effect.gen(function* () {
      const files = new Map(validFiles)
      files.delete("build/index.d.ts")
      const error = yield* Effect.flip(validateFiles(files))
      assert.strictEqual(error.reason, "missing-example-package-export:./build/index.d.ts")
    }),
  )

  it.effect("rejects a missing relative declaration reference", () =>
    Effect.gen(function* () {
      const files = new Map(validFiles)
      files.delete("build/Detail.d.ts")
      const error = yield* Effect.flip(validateFiles(files))
      assert.strictEqual(
        error.reason,
        "missing-example-declaration-reference:build/Public.d.ts:./Detail.js",
      )
    }),
  )

  it.effect("rejects declaration references that escape the package", () =>
    Effect.gen(function* () {
      const files = new Map(validFiles)
      files.set("build/index.d.ts", 'export * from "../../private.ts"\n')
      const error = yield* Effect.flip(validateFiles(files))
      assert.strictEqual(error.reason, "escaping-example-declaration-reference")
    }),
  )

  it.effect("rejects private source from a purported public package", () =>
    Effect.gen(function* () {
      const files = new Map(validFiles)
      files.set("src/Internal.ts", "export const secret = true\n")
      const error = yield* Effect.flip(validateFiles(files))
      assert.strictEqual(error.reason, "private-example-package-entry")
    }),
  )

  it.effect("rejects grader and solution controls even when they are not exported", () =>
    Effect.gen(function* () {
      for (const privatePath of [
        "grader/expected.json",
        "controls/reference.patch",
        "controls/broken.patch",
      ]) {
        const files = new Map(validFiles)
        files.set(privatePath, "withheld\n")
        const error = yield* Effect.flip(validateFiles(files))
        assert.strictEqual(error.reason, "private-example-package-entry")
      }
    }),
  )

  it.effect("rejects export targets that escape the package", () =>
    Effect.gen(function* () {
      const files = new Map(validFiles)
      files.set(
        "package.json",
        JSON.stringify({
          name: "@better-native/example",
          exports: {
            ".": { types: "../grader/expected.d.ts", import: "./build/index.js" },
          },
        }),
      )
      const error = yield* Effect.flip(validateFiles(files))
      assert.strictEqual(error.reason, "unsafe-example-package-export-target")
    }),
  )

  it.effect("rejects traversal and link entries before archive extraction", () =>
    Effect.gen(function* () {
      const traversal = yield* Effect.flip(
        validateArchiveListing(
          "example",
          "package/package.json\npackage/../grader/expected.json\n",
          "-rw-r--r-- user/group 1 date package/package.json\n",
        ),
      )
      assert.strictEqual(traversal.reason, "unsafe-example-package-archive")

      const link = yield* Effect.flip(
        validateArchiveListing(
          "example",
          "package/package.json\npackage/build/index.d.ts\n",
          "-rw-r--r-- user/group 1 date package/package.json\n" +
            "lrwxr-xr-x user/group 0 date package/build/index.d.ts -> ../../private\n",
        ),
      )
      assert.strictEqual(link.reason, "unsafe-example-package-archive")

      const unexpectedType = yield* Effect.flip(
        validateArchiveListing(
          "example",
          "package/package.json\npackage/build/index.d.ts\n",
          "-rw-r--r-- user/group 1 date package/package.json\n" +
            "prw-r--r-- user/group 0 date package/build/index.d.ts\n",
        ),
      )
      assert.strictEqual(unexpectedType.reason, "unsafe-example-package-archive")
    }),
  )
})
