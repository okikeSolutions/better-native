/**
 * Live Expo implementation of the Effect-native Network capability.
 *
 * @since 0.1.0
 */
import * as ExpoNetwork from "expo-network"
import { layerFromNative } from "./NetworkAdapter.ts"

/**
 * Provides Network through expo-network with boundary decoding and tracing.
 *
 * @category layers
 * @since 0.1.0
 */
export const NetworkLive = layerFromNative({
  getNetworkStateAsync: ExpoNetwork.getNetworkStateAsync,
  addNetworkStateListener: ExpoNetwork.addNetworkStateListener
})
