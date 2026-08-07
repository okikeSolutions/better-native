const targets = [
  "apps/compatibility-suite/src/generated",
  "packages/battery/src/Expo.ts",
  "packages/keep-awake/src/Expo.ts",
  "packages/network/src/Expo.ts",
  "packages/secure-store/src/Expo.ts",
]

const snapshot = async (): Promise<ReadonlyMap<string, string>> => {
  const entries = new Map<string, string>()
  for (const target of targets) {
    const file = Bun.file(target)
    if (!(await file.exists())) continue
    const stat = await file.stat()
    if (stat.isFile()) {
      const bytes = await file.arrayBuffer()
      const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
      entries.set(target, hash)
      continue
    }
    const glob = new Bun.Glob("**/*")
    for await (const relative of glob.scan({ cwd: target, onlyFiles: true })) {
      const path = `${target}/${relative}`
      const bytes = await Bun.file(path).arrayBuffer()
      const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
      entries.set(path, hash)
    }
  }
  return entries
}

const before = await snapshot()
const generated = Bun.spawn(["bun", "run", "better-native", "generate"], {
  cwd: process.cwd(),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
const exitCode = await generated.exited
if (exitCode !== 0) process.exit(exitCode)
const after = await snapshot()
const files = [...new Set([...before.keys(), ...after.keys()])].toSorted()
const changed = files.filter((file) => before.get(file) !== after.get(file))
if (changed.length > 0) {
  console.error(`Generated compatibility outputs are stale:\n${changed.join("\n")}`)
  process.exit(1)
}
