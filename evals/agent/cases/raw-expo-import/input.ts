import * as Network from "expo-network"

export const isOnline = Network.getNetworkStateAsync().then((state) => state.isInternetReachable)
