let secret
let state

export const configureDxEval = (token, scenario) => {
  if (secret !== undefined) throw new Error("controlled expo-sqlite state already configured")
  secret = token
  state = {
    scenario,
    closeCalls: 0,
    openCalls: 0,
    operations: [],
    parametersMatched: true,
    value: undefined,
  }
}

export const snapshotDxEval = (token) => {
  if (token !== secret || state === undefined) throw new Error("invalid controller token")
  return {
    closeCalls: state.closeCalls,
    openCalls: state.openCalls,
    operations: [...state.operations],
    parametersMatched: state.parametersMatched,
  }
}

const control = () => {
  if (state === undefined) throw new Error("controlled expo-sqlite state is unavailable")
  return state
}

const operation = (sql) => {
  const normalized = sql.trim().toUpperCase()
  if (normalized.startsWith("BEGIN")) return "begin"
  if (normalized.startsWith("COMMIT")) return "commit"
  if (normalized.startsWith("ROLLBACK")) return "rollback"
  if (normalized.startsWith("CREATE")) return "create"
  if (normalized.startsWith("INSERT")) return "insert"
  if (normalized.startsWith("SELECT")) return "select"
  return "other"
}

export const openDatabaseAsync = async (databaseName, options, directory) => {
  const nativeState = control()
  nativeState.openCalls += 1
  nativeState.parametersMatched &&=
    databaseName === "dx.eval.sqlite" && options === undefined && directory === undefined
  return {
    databasePath: "/sqlite/dx.eval.sqlite",
    closeAsync: async () => {
      nativeState.closeCalls += 1
    },
    getAllAsync: async (sql, params) => {
      const current = operation(sql)
      nativeState.operations.push(current)
      if (current === "insert") {
        nativeState.parametersMatched &&=
          sql.includes("?") && Array.isArray(params) && params[0] === "controlled-value"
        nativeState.value = "controlled-value"
        return []
      }
      if (current === "select") {
        if (nativeState.scenario === "query-failure") {
          const error = Object.assign(new Error("controlled SQLite busy"), { code: "SQLITE_BUSY" })
          throw error
        }
        return [{ value: nativeState.value ?? null }]
      }
      return []
    },
    getEachAsync: () =>
      (async function* () {
        yield undefined
      })(),
    prepareAsync: async () => {
      throw new Error("prepared statements are not expected in this DX eval")
    },
    serializeAsync: async () => new Uint8Array(),
    syncLibSQL: async () => undefined,
    loadExtensionAsync: async () => undefined,
  }
}

export const addDatabaseChangeListener = () => ({ remove: () => undefined })
