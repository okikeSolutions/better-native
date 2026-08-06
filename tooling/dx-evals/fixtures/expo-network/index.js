let secret
let state

export const configureDxEval = (token, scenario) => {
  if (secret !== undefined) throw new Error("controlled expo-network state already configured")
  secret = token
  state = { scenario, calls: 0 }
}

export const snapshotDxEval = (token) => {
  if (token !== secret || state === undefined) throw new Error("invalid controller token")
  return { calls: state.calls }
}

const control = () => {
  if (state === undefined) throw new Error("controlled expo-network state is unavailable")
  return state
}

export const NetworkStateType = {
  NONE: "NONE",
  UNKNOWN: "UNKNOWN",
  CELLULAR: "CELLULAR",
  WIFI: "WIFI",
  BLUETOOTH: "BLUETOOTH",
  ETHERNET: "ETHERNET",
  WIMAX: "WIMAX",
  VPN: "VPN",
  OTHER: "OTHER",
}

export const getNetworkStateAsync = async () => {
  const nativeState = control()
  nativeState.calls += 1
  switch (nativeState.scenario) {
    case "available":
      return { type: "WIFI", isConnected: true, isInternetReachable: true }
    case "unavailable":
      throw Object.assign(new Error("native API unavailable"), { code: "ERR_UNAVAILABLE" })
    case "failure":
      throw new Error("native network failure")
    case "malformed":
      return { type: "NOT_A_NETWORK_TYPE", isConnected: true, isInternetReachable: true }
    default:
      throw new Error(`unknown controlled scenario: ${String(nativeState.scenario)}`)
  }
}

export const getIpAddressAsync = async () => "127.0.0.1"
export const isAirplaneModeEnabledAsync = async () => false
export const addNetworkStateListener = () => ({ remove() {} })
export const useNetworkState = () => ({})
