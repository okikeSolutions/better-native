export const BackgroundTaskStatus = { Restricted: 1, Available: 2 }
export const BackgroundTaskResult = { Success: 1, Failed: 2 }

let secret
let state

export const configureDxEval = (token, scenario) => {
  if (secret !== undefined)
    throw new Error("controlled expo-background-task state already configured")
  secret = token
  state = { scenario, registerCalls: [], statusCalls: 0 }
}

export const snapshotDxEval = (token) => {
  if (token !== secret || state === undefined) throw new Error("invalid controller token")
  return {
    registerCalls: state.registerCalls,
    statusCalls: state.statusCalls,
  }
}

const control = () => {
  if (state === undefined) throw new Error("controlled expo-background-task state is unavailable")
  return state
}

export const getStatusAsync = async () => {
  const current = control()
  current.statusCalls += 1
  return current.scenario === "restricted"
    ? BackgroundTaskStatus.Restricted
    : BackgroundTaskStatus.Available
}
export const registerTaskAsync = async (name, options) => {
  control().registerCalls.push({ name, minimumInterval: options?.minimumInterval })
}
export const unregisterTaskAsync = async () => undefined
export const triggerTaskWorkerForTestingAsync = async () => false
export const addExpirationListener = () => ({ remove() {} })
