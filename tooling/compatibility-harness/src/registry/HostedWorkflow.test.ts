import * as BunServices from "@effect/platform-bun/BunServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"

describe("hosted compatibility workflow", () => {
  it.effect("uses Expo-derived job ownership and profiles", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const [
        workflow,
        checkWorkflow,
        staticSetup,
        buildSetup,
        expoSourceSetup,
        deviceSetup,
        compareSetup,
        changeDetection,
        ccacheSetup,
        cacheSetup,
        maestroSetup,
        turboConfig,
      ] = yield* Effect.all([
        fs.readFileString(".github/workflows/compatibility.yml"),
        fs.readFileString(".github/workflows/check.yml"),
        fs.readFileString(".github/actions/setup-static/action.yml"),
        fs.readFileString(".github/actions/setup-build/action.yml"),
        fs.readFileString(".github/actions/setup-expo-source/action.yml"),
        fs.readFileString(".github/actions/setup-device-test/action.yml"),
        fs.readFileString(".github/actions/setup-compare/action.yml"),
        fs.readFileString(".github/actions/detect-compatibility-change/action.yml"),
        fs.readFileString(".github/actions/setup-ccache/action.yml"),
        fs.readFileString(".github/actions/setup-expo-caches/action.yml"),
        fs.readFileString(".github/actions/setup-maestro/action.yml"),
        fs.readFileString("turbo.json"),
      ])
      assert.match(staticSetup, /bun install --frozen-lockfile/)
      assert.notMatch(staticSetup, /ignore-scripts/)
      assert.match(buildSetup, /node-version: 24/)
      assert.match(buildSetup, /version: 10\.33\.0/)
      assert.match(buildSetup, /setup-expo-source/)
      assert.match(buildSetup, /pnpm store path/)
      assert.match(buildSetup, /node-24-pnpm-10-expo/)
      assert.match(expoSourceSetup, /fetch --depth=1 origin/)
      assert.match(expoSourceSetup, /actual_revision=.*rev-parse HEAD/)
      assert.match(deviceSetup, /setup-static/)
      assert.match(compareSetup, /setup-static/)
      assert.match(changeDetection, /tj-actions\/changed-files/)
      assert.match(changeDetection, /should_run_web/)
      assert.match(ccacheSetup, /CCACHE_COMPILERCHECK=content/)
      assert.match(cacheSetup, /xcodebuild -version/)
      assert.match(cacheSetup, /gradle\/actions\/setup-gradle/)
      assert.notMatch(workflow, /TURBO_API/)
      assert.notMatch(workflow, /TURBO_TOKEN/)
      assert.notMatch(workflow, /setup-project/)
      assert.notMatch(workflow, /setup-native-build-cache/)
      assert.match(checkWorkflow, /setup-build/)
      assert.notMatch(checkWorkflow, /TURBO_API/)
      assert.match(turboConfig, /"signature": true/)
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
      assert.match(workflow, /cron: "0 3 \* \* 1"/)
      assert.match(workflow, /^  detect-platform-changes:$/m)
      assert.match(
        workflow,
        /detect-platform-changes:[\s\S]*?steps:[\s\S]*?uses: actions\/checkout@[\s\S]*?uses: \.\/\.github\/actions\/detect-compatibility-change/,
      )
      assert.match(workflow, /^  web-baseline:$/m)
      assert.match(workflow, /^  web-pair:$/m)
      assert.match(workflow, /^  web-compare:$/m)
      assert.match(workflow, /^  ios-compare:$/m)
      assert.match(workflow, /^  android-compare:$/m)
      assert.strictEqual(workflow.match(/supervise-web-pair/g)?.length, 1)
      assert.strictEqual(workflow.match(/supervise-build-pair/g)?.length, 2)
      assert.strictEqual(workflow.match(/supervise-native-pair/g)?.length, 2)
      assert.strictEqual(workflow.match(/run: bun run expo:prepare/g)?.length, 4)
      assert.match(workflow, /Setup device-test profile/)
      assert.match(workflow, /Setup compare profile/)
      assert.match(workflow, /Materialize pinned Expo/)
      assert.match(workflow, /Refusing unsafe archive entry/)
      assert.match(workflow, /\$\{BUILD_ID\}-upstream\/record\.json/)
      assert.notMatch(workflow, /COMPATIBILITY_MODE:\+-upstream/)
    }).pipe(Effect.provide(BunServices.layer)),
  )
})
