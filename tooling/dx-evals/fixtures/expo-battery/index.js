let secret
let state

export const configureDxEval = (token, scenario) => {
  if (secret !== undefined) throw new Error("controlled expo-battery state already configured")
  secret = token
  state = { scenario, registrations: 0, removals: 0, emitted: 0 }
}

export const snapshotDxEval = (token) => {
  if (token !== secret || state === undefined) throw new Error("invalid controller token")
  return {
    registrations: state.registrations,
    removals: state.removals,
    emitted: state.emitted,
  }
}

const control = () => {
  if (state === undefined) throw new Error("controlled expo-battery state is unavailable")
  return state
}

export const BatteryState = {
  UNKNOWN: 0,
  UNPLUGGED: 1,
  CHARGING: 2,
  FULL: 3,
}

export const addBatteryLevelListener = (listener) => {
  const nativeState = control()
  nativeState.registrations += 1
  if (nativeState.scenario === "listener-failure") {
    throw new Error("controlled listener registration failure")
  }
  queueMicrotask(() => {
    for (const batteryLevel of [0.21, 0.84]) {
      nativeState.emitted += 1
      listener({ batteryLevel })
    }
  })
  return {
    remove() {
      nativeState.removals += 1
    },
  }
}

export const addBatteryStateListener = () => ({ remove() {} })
export const addLowPowerModeListener = () => ({ remove() {} })
export const getBatteryLevelAsync = async () => 0.5
export const getBatteryStateAsync = async () => BatteryState.UNKNOWN
export const isAvailableAsync = async () => true
export const isLowPowerModeEnabledAsync = async () => false
export const isBatteryOptimizationEnabledAsync = async () => false
export const getPowerStateAsync = async () => ({
  batteryLevel: 0.5,
  batteryState: BatteryState.UNKNOWN,
  lowPowerMode: false,
})
