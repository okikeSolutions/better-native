import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { environmentKeys } from "../HarnessConfig.ts"
import { provideLayer } from "../TestLayers.ts"

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
        androidEmulator,
        turboConfig,
        rootPackage,
        harnessPackage,
        appBuildExecutor,
        cacheHygiene,
        envExample,
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
        fs.readFileString(".github/actions/use-android-emulator/action.yml"),
        fs.readFileString("turbo.json"),
        fs.readFileString("package.json"),
        fs.readFileString("tooling/compatibility-harness/package.json"),
        fs.readFileString("tooling/compatibility-harness/src/build/AppBuildExecutor.ts"),
        fs.readFileString(".github/workflows/cache-hygiene.yml"),
        fs.readFileString(".env.example"),
      ])
      assert.match(staticSetup, /node-version: 24/)
      assert.match(staticSetup, /bun install --frozen-lockfile/)
      assert.notMatch(staticSetup, /ignore-scripts/)
      assert.notMatch(buildSetup, /node-version: 24/)
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
      assert.match(workflow, /TURBO_TOKEN: \$\{\{ secrets\.TURBO_TOKEN \}\}/)
      assert.match(workflow, /TURBO_TEAM: \$\{\{ vars\.TURBO_TEAM \}\}/)
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
      assert.match(workflow, /name: iOS device test \(\$\{\{ matrix\.shard-label \}\}\/2\)/)
      assert.match(workflow, /SHARD_COUNT: 2/)
      assert.strictEqual(workflow.match(/--shard-index "\$SHARD_INDEX"/g)?.length, 2)
      assert.match(workflow, /compatibility-ios-run-evidence-.*-shard-\*/)
      assert.match(workflow, /merge-multiple: true/)
      assert.match(workflow, /Group iOS evidence by build mode/)
      assert.match(workflow, /--upstream \.artifacts\/compare\/upstream/)
      assert.match(workflow, /--candidate \.artifacts\/compare\/candidate/)
      assert.match(workflow, /if \[ "\$DEVICE_STATE" != Shutdown \]; then/)
      assert.notMatch(workflow, /simctl shutdown "\$DEVICE_ID" \|\| true/)
      assert.match(workflow, /^  android-compare:$/m)
      assert.strictEqual(workflow.match(/supervise-web-pair/g)?.length, 1)
      assert.match(workflow, /web-upstream-run-\*/)
      assert.match(workflow, /web-\*-run-\*/)
      assert.strictEqual(workflow.match(/supervise-build-pair/g)?.length, 2)
      assert.strictEqual(workflow.match(/supervise-native-pair/g)?.length, 2)
      assert.match(
        workflow,
        /uses: \.\/\.github\/actions\/use-android-emulator[\s\S]*?script: \|\n\s+if \[ "\$COMPATIBILITY_MODE" = pair \]; then\n/,
      )
      assert.notMatch(workflow, /uses: reactivecircus\/android-emulator-runner@/)
      assert.notMatch(workflow, /script: \|\n\s+set -euo pipefail/)
      assert.match(androidEmulator, /99-kvm4all\.rules/)
      assert.match(androidEmulator, /udevadm trigger --name-match=kvm/)
      assert.match(androidEmulator, /id: compatibility-script/)
      assert.match(androidEmulator, /COMPATIBILITY_SCRIPT: \$\{\{ inputs\.script \}\}/)
      assert.match(
        androidEmulator,
        /mktemp "\$\{RUNNER_TEMP:\?\}\/better-native-android\.XXXXXX\.sh"/,
      )
      assert.strictEqual(
        androidEmulator.match(/bash "\$\{\{ steps\.compatibility-script\.outputs\.path \}\}"/g)
          ?.length,
        3,
      )
      assert.strictEqual(androidEmulator.match(/\$\{\{ inputs\.script \}\}/g)?.length, 1)
      assert.notMatch(androidEmulator, /\[ ! -r \/dev\/kvm \] \|\| \[ ! -w \/dev\/kvm \]/)
      assert.notMatch(androidEmulator, /KVM is unavailable to the GitHub Actions runner/)
      assert.strictEqual(
        androidEmulator.match(/reactivecircus\/android-emulator-runner@/g)?.length,
        3,
      )
      assert.strictEqual(androidEmulator.match(/profile: pixel_7_pro/g)?.length, 3)
      assert.strictEqual(
        androidEmulator.match(/api-level: \$\{\{ inputs\.avd-api \}\}/g)?.length,
        3,
      )
      assert.match(
        androidEmulator,
        /steps\.attempt-1\.outcome == 'failure' && hashFiles\('\.artifacts\/runs\/\*\*\/flow\.yaml'\) == ''/,
      )
      assert.match(
        androidEmulator,
        /steps\.attempt-1\.outcome == 'failure' && hashFiles\('\.artifacts\/runs\/\*\*\/flow\.yaml'\) != ''/,
      )
      assert.strictEqual(workflow.match(/run: bun run compatibility:prepare/g)?.length, 4)
      assert.notMatch(workflow, /run: bun run expo:prepare/)
      assert.match(
        rootPackage,
        /"compatibility:prepare": "turbo run \/\/#compatibility:dependencies/,
      )
      const turboTasks = (
        JSON.parse(turboConfig) as {
          readonly tasks: Readonly<Record<string, { readonly dependsOn?: ReadonlyArray<string> }>>
        }
      ).tasks
      assert.deepStrictEqual(
        turboTasks["@better-native/compatibility-suite#typecheck"]?.dependsOn,
        ["^typecheck", "^build"],
      )
      assert.deepStrictEqual(turboTasks["//#compatibility:dependencies"]?.dependsOn, [
        "//#expo:toolchain",
        "@better-native/network#build",
        "@better-native/battery#build",
        "@better-native/keep-awake#build",
        "@better-native/secure-store#build",
        "@better-native/metro#build",
      ])
      assert.match(workflow, /Setup device-test profile/)
      assert.match(workflow, /Setup compare profile/)
      assert.match(workflow, /Prepare compatibility dependencies/)
      assert.match(workflow, /workspace="ios-\$\{mode\}"/)
      assert.match(workflow, /workspace="android-\$\{mode\}"/)
      assert.match(cacheSetup, /native-v1-/)
      assert.match(cacheSetup, /pods-v1-release-/)
      assert.notMatch(cacheSetup, /apps\/compatibility-suite\/\*\*/)
      assert.match(cacheHygiene, /CACHE_BUDGET_BYTES: "8589934592"/)
      assert.match(workflow, /BETTER_NATIVE_FORCE_COLD_BUILD:/)
      assert.match(workflow, /BETTER_NATIVE_IOS_DESTINATION=platform=iOS Simulator,id=/)
      assert.match(appBuildExecutor, /"--build-cache",\s+"--no-configuration-cache"/)
      for (const name of Object.values(environmentKeys)) {
        assert.match(envExample, new RegExp(`^#? ?${name}=`, "m"), `${name} must be documented`)
      }
      assert.match(workflow, /Refusing unsafe archive entry/)
      assert.match(workflow, /\$\{BUILD_ID\}-upstream\/record\.json/)
      assert.notMatch(workflow, /COMPATIBILITY_MODE:\+-upstream/)
      assert.match(rootPackage, /"compatibility-harness": "node --experimental-strip-types/)
      assert.match(harnessPackage, /"@effect\/platform-node": "4\.0\.0-beta\.102"/)
      assert.notMatch(harnessPackage, /@effect\/platform-bun/)
    }).pipe(provideLayer(NodeServices.layer)),
  )
})
