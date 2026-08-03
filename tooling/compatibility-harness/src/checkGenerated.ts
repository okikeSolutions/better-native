const directory = "apps/compatibility-suite/src/generated"

const snapshot = async (): Promise<ReadonlyMap<string, string>> => {
  const entries = new Map<string, string>()
  const glob = new Bun.Glob("**/*")
  for await (const relative of glob.scan({ cwd: directory, onlyFiles: true })) {
    const bytes = await Bun.file(`${directory}/${relative}`).arrayBuffer()
    const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
    entries.set(relative, hash)
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
  console.error(`Generated compatibility registry is stale:\n${changed.join("\n")}`)
  process.exit(1)
}
