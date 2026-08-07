import { assert, it } from "@effect/vitest"
import * as Isolation from "../Isolation.ts"
import { entrypoint, exportName, makeConfig } from "../IsolationTestSupport.ts"

it("requires the complete production containment policy", () => {
  const config = makeConfig("io.better-native.dx-evals.conformance=static")
  const args = Isolation.makePodmanArgs(
    config,
    {
      workspace: "/candidate",
      entrypoint,
      exportName,
    },
    "better-native-eval-conformance",
  )
  const optionValue = (option: string) => {
    const index = args.indexOf(option)
    return index < 0 ? undefined : args[index + 1]
  }

  assert.strictEqual(args[0], "run")
  assert.isTrue(args.includes("--rm"))
  assert.isTrue(args.includes("--interactive"))
  assert.strictEqual(optionValue("--name"), "better-native-eval-conformance")
  assert.strictEqual(optionValue("--pull"), "never")
  assert.strictEqual(optionValue("--label"), config.sandboxLabel)
  assert.strictEqual(optionValue("--network"), "none")
  assert.strictEqual(optionValue("--user"), "65532:65532")
  assert.strictEqual(optionValue("--env"), "HOME=/tmp")
  assert.strictEqual(optionValue("--pid"), "private")
  assert.strictEqual(optionValue("--ipc"), "private")
  assert.isTrue(args.includes("--read-only"))
  assert.strictEqual(optionValue("--cap-drop"), "all")
  assert.strictEqual(optionValue("--security-opt"), "no-new-privileges")
  assert.strictEqual(optionValue("--pids-limit"), "64")
  assert.strictEqual(optionValue("--memory"), "256m")
  assert.strictEqual(optionValue("--cpus"), "1")
  assert.isTrue(args.includes("--disallow-code-generation-from-strings"))
  assert.isTrue(args.includes("/tmp:rw,noexec,nosuid,nodev,size=16m"))
  assert.isTrue(args.includes("/root:rw,noexec,nosuid,nodev,size=16m"))
  assert.isTrue(
    args
      .filter((argument) => argument.includes(":/workspace"))
      .every((mount) => mount.endsWith(":ro")),
  )
  assert.isTrue(
    args
      .filter((argument) => argument.includes(":/runner"))
      .every((mount) => mount.endsWith(":ro")),
  )
})
