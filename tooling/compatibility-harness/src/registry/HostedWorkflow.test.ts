import * as BunServices from "@effect/platform-bun/BunServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"

describe("hosted compatibility workflow", () => {
  it.effect("isolates every explicitly pinned Corepack pnpm command from Bun", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const [workflow, projectSetup, maestroSetup] = yield* Effect.all([
        fs.readFileString(".github/workflows/compatibility.yml"),
        fs.readFileString(".github/actions/setup-project/action.yml"),
        fs.readFileString(".github/actions/setup-maestro/action.yml"),
      ])
      const commands = workflow.match(/corepack pnpm@10\.33\.0[^\n]*/g) ?? []
      assert.isAbove(commands.length, 0)
      assert.match(workflow, /^env:\n(?:.*\n)*?  COREPACK_ENABLE_PROJECT_SPEC: "0"$/m)
      assert.match(projectSetup, /node-version: 24/)
      assert.notMatch(projectSetup, /node-version: 22/)
      assert.match(workflow, /version: 2\.6\.1/)
      assert.match(workflow, /version: 2\.4\.0/)
      assert.match(
        maestroSetup,
        /2\.4\.0\).*aea22ce67ab6718997ec990c58652ede0c2be8f10ac4799039ca3dce3390d634/,
      )
      assert.match(
        maestroSetup,
        /2\.6\.1\).*3440825f514f537c6a96bcf5de995780c2a4a7f83a43208fdc95d4f1fecfad3b/,
      )
      assert.strictEqual(
        workflow.match(/uses: \.\/\.github\/actions\/cleanup-linux-disk-space/g)?.length,
        2,
      )
      assert.match(workflow, /^  compatibility-gate:$/m)
      assert.match(workflow, /cron: "0 3 \* \* 1"/)
    }).pipe(Effect.provide(BunServices.layer)),
  )
})
