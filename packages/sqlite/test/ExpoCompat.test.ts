import { describe, expect, it, vi } from "vitest"

const plugin = vi.fn()
const kvStore = vi.hoisted(() => ({
  default: { getItem: vi.fn() },
}))
const installLocalStorage = vi.hoisted(() => vi.fn())

const runtime = {
  SQLiteDatabase: class SQLiteDatabase {},
  SQLiteProvider: vi.fn(),
  SQLiteSession: class SQLiteSession {},
  SQLiteStatement: class SQLiteStatement {},
  SQLiteTaggedQuery: class SQLiteTaggedQuery {},
  addDatabaseChangeListener: vi.fn(),
  backupDatabaseAsync: vi.fn(),
  backupDatabaseSync: vi.fn(),
  bundledExtensions: {},
  deepEqual: vi.fn(),
  defaultDatabaseDirectory: "/sqlite",
  deleteDatabaseAsync: vi.fn(),
  deleteDatabaseSync: vi.fn(),
  deserializeDatabaseAsync: vi.fn(),
  deserializeDatabaseSync: vi.fn(),
  importDatabaseFromAssetAsync: vi.fn(),
  openDatabaseAsync: vi.fn(),
  openDatabaseSync: vi.fn(),
  useSQLiteContext: vi.fn(),
}

vi.mock("expo-sqlite", () => runtime)
vi.mock("expo-sqlite/plugin", () => ({ default: plugin }))
vi.mock("expo-sqlite/kv-store", () => kvStore)
vi.mock("expo-sqlite/localStorage/install", () => {
  installLocalStorage()
  return {}
})

const ExpoSQLite = await import("expo-sqlite")
const Compat = await import("../src/Expo")
const Plugin = await import("../src/Plugin")
const KVStore = await import("../src/KVStore")
await import("../src/LocalStorageInstall")

describe("@better-native/sqlite/expo", () => {
  it("preserves every Expo root runtime export by identity", () => {
    for (const name of Object.keys(ExpoSQLite)) {
      expect(Reflect.get(Compat, name), name).toBe(Reflect.get(ExpoSQLite, name))
    }
  })

  it("preserves the config-plugin default export shape", () => {
    expect(Plugin.default).toBe(plugin)
  })

  it("preserves the kv-store default export and localStorage installation side effect", () => {
    expect(KVStore.default).toBe(kvStore.default)
    expect(installLocalStorage).toHaveBeenCalledTimes(1)
  })
})
