import NetInfo, { NetInfoState, NetInfoSubscription } from '@react-native-community/netinfo'
import supabase from '../lib/supabase'
import { getDeviceId } from '../device/identity'
import useMeshStore from '../store/meshStore'

type MeshRole = 'gateway' | 'relay' | 'offline'
type ConnType = 'bluetooth' | 'wifi_direct' | 'both'

const TELEMETRY_INTERVAL_MS = 5000
const RELAYED_RESET_INTERVAL_MS = 60000

let telemetryIntervalId: ReturnType<typeof setInterval> | null = null
let relayResetIntervalId: ReturnType<typeof setInterval> | null = null
let netInfoUnsubscribe: NetInfoSubscription | null = null
let latestNetState: NetInfoState | null = null

const isOnlineState = (state: NetInfoState | null): boolean => {
  return state?.isConnected === true && state?.isInternetReachable === true
}

const getConnType = (
  peers: Array<{ id: string; transport: 'BLE' | 'WIFI_DIRECT'; rssi?: number }>
): ConnType => {
  const hasWifiDirect = peers.some((peer) => peer.transport === 'WIFI_DIRECT')
  const hasBluetooth = peers.some((peer) => peer.transport === 'BLE')

  if (hasWifiDirect && hasBluetooth) {
    return 'both'
  }

  if (hasWifiDirect) {
    return 'wifi_direct'
  }

  return 'bluetooth'
}

const startTelemetryInterval = (): void => {
  if (telemetryIntervalId) {
    return
  }

  telemetryIntervalId = setInterval(() => {
    void pushTelemetry()
  }, TELEMETRY_INTERVAL_MS)
}

const stopTelemetryInterval = (): void => {
  if (!telemetryIntervalId) {
    return
  }

  clearInterval(telemetryIntervalId)
  telemetryIntervalId = null
}

const pushTelemetry = async (): Promise<void> => {
  try {
    const deviceId = await getDeviceId()
    const { myMascot, currentPeers, relayedCount } = useMeshStore.getState()
    const netState = await NetInfo.fetch()

    const role: MeshRole = netState.isConnected === true ? 'gateway' : 'relay'
    const connType = getConnType(currentPeers)

    const { error } = await supabase.from('mesh_telemetry').upsert(
      {
        device_id: deviceId,
        mascot: myMascot,
        role,
        peer_ids: currentPeers.map((peer) => peer.id),
        hop_count: relayedCount,
        conn_type: connType,
        is_origin: false,
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'device_id' }
    )

    if (error) {
      throw new Error(error.message)
    }
  } catch (error) {
    console.warn('[TelemetryReporter] pushTelemetry failed', error)
  }
}

const pushOfflineStatus = async (): Promise<void> => {
  try {
    const deviceId = await getDeviceId()
    const { myMascot, relayedCount } = useMeshStore.getState()

    const { error } = await supabase.from('mesh_telemetry').upsert(
      {
        device_id: deviceId,
        mascot: myMascot,
        role: 'offline' as MeshRole,
        peer_ids: [],
        hop_count: relayedCount,
        conn_type: 'bluetooth' as ConnType,
        is_origin: false,
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'device_id' }
    )

    if (error) {
      throw new Error(error.message)
    }
  } catch (error) {
    console.warn('[TelemetryReporter] pushOfflineStatus failed', error)
  }
}

export function startTelemetryReporter(): void {
  try {
    if (!relayResetIntervalId) {
      relayResetIntervalId = setInterval(() => {
        try {
          useMeshStore.getState().resetRelayedCount()
        } catch (error) {
          console.warn('[TelemetryReporter] resetRelayedCount failed', error)
        }
      }, RELAYED_RESET_INTERVAL_MS)
    }

    if (netInfoUnsubscribe) {
      return
    }

    netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      try {
        latestNetState = state

        if (isOnlineState(state)) {
          startTelemetryInterval()
          void pushTelemetry()
          return
        }

        if (state.isConnected === false) {
          void pushOfflineStatus()
        }

        stopTelemetryInterval()
      } catch (error) {
        console.warn('[TelemetryReporter] connectivity listener failed', error)
      }
    })

    void (async () => {
      try {
        const state = await NetInfo.fetch()
        latestNetState = state

        if (isOnlineState(state)) {
          startTelemetryInterval()
          await pushTelemetry()
        }
      } catch (error) {
        console.warn('[TelemetryReporter] initial state check failed', error)
      }
    })()
  } catch (error) {
    console.warn('[TelemetryReporter] start failed', error)
  }
}

export function stopTelemetryReporter(): void {
  try {
    stopTelemetryInterval()

    if (relayResetIntervalId) {
      clearInterval(relayResetIntervalId)
      relayResetIntervalId = null
    }

    if (netInfoUnsubscribe) {
      netInfoUnsubscribe()
      netInfoUnsubscribe = null
    }

    latestNetState = null
  } catch (error) {
    console.warn('[TelemetryReporter] stop failed', error)
  }
}

export const __telemetryReporterTestUtils = {
  pushTelemetry,
  pushOfflineStatus,
  getLatestNetState: (): NetInfoState | null => latestNetState,
}
