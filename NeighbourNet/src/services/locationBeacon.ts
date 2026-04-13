import * as Location from 'expo-location'
import useAppStore from '../store/useAppStore'
import { getDisplayName, getMyFriendCode } from './profileService'
import { getDeviceUUID } from './appState'

interface LocationBeacon {
  type: 'LOCATION_BEACON'
  senderId: string
  displayName: string
  friendCode: string
  lat: number
  lng: number
  timestamp: number
  accuracy?: number
}

type BeaconSender = (messageJson: string) => Promise<number> | void

let beaconInterval: ReturnType<typeof setInterval> | null = null

async function sendBeacon(sendMessage: BeaconSender): Promise<void> {
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    })

    const state = useAppStore.getState()
    const senderId = state.deviceId ?? (await getDeviceUUID())
    const displayName = state.ownDisplayName || (await getDisplayName())
    const friendCode = await getMyFriendCode()

    const beacon: LocationBeacon = {
      type: 'LOCATION_BEACON',
      senderId,
      displayName,
      friendCode,
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      timestamp: Date.now(),
      accuracy: typeof position.coords.accuracy === 'number' ? position.coords.accuracy : undefined,
    }

    await Promise.resolve(sendMessage(JSON.stringify(beacon)))
  } catch (error) {
    console.warn('[LocationBeacon] Failed to send location beacon:', error)
  }
}

export function startBeaconBroadcast(sendMessage: BeaconSender): void {
  if (beaconInterval) {
    clearInterval(beaconInterval)
  }

  void sendBeacon(sendMessage)
  beaconInterval = setInterval(() => {
    void sendBeacon(sendMessage)
  }, 20000)
}

export function stopBeaconBroadcast(): void {
  if (!beaconInterval) {
    return
  }

  clearInterval(beaconInterval)
  beaconInterval = null
}
