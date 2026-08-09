let secret
let state

export const configureDxEval = (token) => {
  if (secret !== undefined) throw new Error("controlled expo-task-manager state already configured")
  secret = token
  state = { definitions: new Map(), handlerResult: undefined, isDefinedCalls: 0 }
}

export const snapshotDxEval = (token) => {
  if (token !== secret || state === undefined) throw new Error("invalid controller token")
  return {
    defineCalls: state.definitions.size,
    handlerResult: state.handlerResult,
    isDefinedCalls: state.isDefinedCalls,
  }
}

const control = () => {
  if (state === undefined) throw new Error("controlled expo-task-manager state is unavailable")
  return state
}

export const defineTask = (name, handler) => control().definitions.set(name, handler)
export const isTaskDefined = (name) => {
  const current = control()
  current.isDefinedCalls += 1
  return current.definitions.has(name)
}
export const invokeDefinedTask = async (name, body) => {
  const current = control()
  const handler = current.definitions.get(name)
  if (handler === undefined) throw new Error("task was not defined")
  current.handlerResult = await handler(body)
}
export const isAvailableAsync = async () => true
export const isTaskRegisteredAsync = async () => false
export const getTaskOptionsAsync = async () => null
export const getRegisteredTasksAsync = async () => []
export const unregisterTaskAsync = async () => undefined
export const unregisterAllTasksAsync = async () => undefined
