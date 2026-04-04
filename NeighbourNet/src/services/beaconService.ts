import { getDeviceUUID } from './appState'
import { getMyFriendCode, getDisplayName } from './profileService'
import { sendMessage } from './meshService'
import { Message } from '../types/message'

let beaconInterval: ReturnType<typeof setInterval> | null = null

export async function startBeacon(): Promise<void> {
  const myUUID = await getDeviceUUID()
  const myCode = await getMyFriendCode()
  const myName = await getDisplayName()

  const sendBeacon = async () => {
    const beacon: Message = {
      message_id: `beacon-${myUUID}-${Date.now()}`,
      body: `BEACON:${myCode}`,        // clear format, won't collide with chat text
      location_hint: myCode,           // friend code here too for redundancy
      sender_id: myUUID,
      sender_name: myName,
      message_type: 'location_beacon',
      destination_id: undefined,       // broadcast to all
      priority_tier: 'LOW',
      priority_score: 0,
      ttl: 3,                          // short TTL — only nearby peers
      hop_count: 0,
      created_at: new Date().toISOString(),
      last_hop_at: new Date().toISOString(),
      synced: false,
      gps_lat: null,
      gps_lng: null,
    }

    try {
      await sendMessage(beacon)
      console.log('[Beacon] Sent identity beacon, code:', myCode, 'uuid:', myUUID)
    } catch (e) {
      console.log('[Beacon] Failed to send beacon:', e)
    }
  }

  // Send immediately on start
  await sendBeacon()

  // Then every 15 seconds
  beaconInterval = setInterval(sendBeacon, 15000)
}

export function stopBeacon(): void {
  if (beaconInterval) {
    clearInterval(beaconInterval)
    beaconInterval = null
  }
}
