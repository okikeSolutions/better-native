let secret
let state

export const configureDxEval = (token, scenario) => {
  if (secret !== undefined) throw new Error("controlled expo-keep-awake state already configured")
  secret = token
  state = {
    scenario,
    availabilityChecks: 0,
    activations: 0,
    deactivations: 0,
    activatedTags: [],
    deactivatedTags: [],
  }
}

export const snapshotDxEval = (token) => {
  if (token !== secret || state === undefined) throw new Error("invalid controller token")
  return {
    availabilityChecks: state.availabilityChecks,
    activations: state.activations,
    deactivations: state.deactivations,
    activatedTags: [...state.activatedTags],
    deactivatedTags: [...state.deactivatedTags],
  }
}

const control = () => {
  if (state === undefined) throw new Error("controlled expo-keep-awake state is unavailable")
  return state
}

export const isAvailableAsync = async () => {
  const nativeState = control()
  nativeState.availabilityChecks += 1
  return nativeState.scenario !== "unavailable"
}

export const activateKeepAwakeAsync = async (tag = "default") => {
  const nativeState = control()
  nativeState.activations += 1
  nativeState.activatedTags.push(tag)
  if (nativeState.scenario === "activation-failure") {
    throw new Error("controlled activation failure")
  }
}

export const deactivateKeepAwake = async (tag = "default") => {
  const nativeState = control()
  nativeState.deactivations += 1
  nativeState.deactivatedTags.push(tag)
}
