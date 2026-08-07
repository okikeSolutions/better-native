let secret
let state

export const configureDxEval = (token, scenario) => {
  if (secret !== undefined) throw new Error("controlled expo-secure-store state already configured")
  secret = token
  state = {
    scenario,
    values: new Map(),
    operations: [],
    writes: 0,
    reads: 0,
    deletes: 0,
    optionsMatched: true,
  }
}

export const snapshotDxEval = (token) => {
  if (token !== secret || state === undefined) throw new Error("invalid controller token")
  return {
    writes: state.writes,
    reads: state.reads,
    deletes: state.deletes,
    operations: [...state.operations],
    valuePresent: state.values.has("dx.eval.token"),
    optionsMatched: state.optionsMatched,
  }
}

const control = () => {
  if (state === undefined) throw new Error("controlled expo-secure-store state is unavailable")
  return state
}

const validate = (nativeState, key, options) => {
  nativeState.optionsMatched &&= key === "dx.eval.token" && options?.keychainService === "dx-eval"
}

export const AFTER_FIRST_UNLOCK = 1
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 2
export const ALWAYS = 3
export const ALWAYS_THIS_DEVICE_ONLY = 4
export const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY = 5
export const WHEN_UNLOCKED = 6
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 7

export const isAvailableAsync = async () => true
export const canUseBiometricAuthentication = () => false

export const setItemAsync = async (key, value, options) => {
  const nativeState = control()
  nativeState.operations.push("write")
  nativeState.writes += 1
  validate(nativeState, key, options)
  nativeState.optionsMatched &&= value === "controlled-secret"
  if (nativeState.scenario === "write-failure") throw new Error("controlled write failure")
  nativeState.values.set(key, value)
}

export const getItemAsync = async (key, options) => {
  const nativeState = control()
  nativeState.operations.push("read")
  nativeState.reads += 1
  validate(nativeState, key, options)
  if (nativeState.scenario === "read-failure") throw new Error("controlled read failure")
  return nativeState.values.get(key) ?? null
}

export const deleteItemAsync = async (key, options) => {
  const nativeState = control()
  nativeState.operations.push("delete")
  nativeState.deletes += 1
  validate(nativeState, key, options)
  nativeState.values.delete(key)
}

export const setItem = (key, value, options) => {
  const nativeState = control()
  nativeState.operations.push("write")
  nativeState.writes += 1
  validate(nativeState, key, options)
  nativeState.optionsMatched &&= value === "controlled-secret"
  if (nativeState.scenario === "write-failure") throw new Error("controlled write failure")
  nativeState.values.set(key, value)
}
export const getItem = (key, options) => {
  const nativeState = control()
  nativeState.operations.push("read")
  nativeState.reads += 1
  validate(nativeState, key, options)
  if (nativeState.scenario === "read-failure") throw new Error("controlled read failure")
  return nativeState.values.get(key) ?? null
}
