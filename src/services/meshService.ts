import { NativeEventEmitter, NativeModules, Platform } from 'react-native'
import type { NativeModule } from 'react-native'
import { triageMessage } from './triageEngine'
import type { Message } from '../types/message'

const NearbyMesh = (NativeModules as {
  NearbyMesh?: NativeModule & {
    startMesh: () => Promise<void>
    scanNow: () => Promise<void>
    stopMesh: () => Promise<void>
    sendMessage: (messageJson: string) => Promise<number>
    getConnectedPeerCount: () => Promise<number>
  }
}).NearbyMesh ?? null

type PeerData = { endpointId: string; peerCount: number }
type MessageEventData = { message: string }

const isAlreadyDiscoveringError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('STATUS_ALREADY_DISCOVERING')
}

export async function startMesh(): Promise<void> {
  if (!NearbyMesh) {
    console.warn(`NearbyMesh: native module not available on ${Platform.OS}, skipping mesh start`)
    return
  }

  await NearbyMesh.startMesh()
}

export async function stopMesh(): Promise<void> {
  if (!NearbyMesh) {
    return
  }

  await NearbyMesh.stopMesh()
}

export async function sendMessage(message: Message): Promise<number> {
  if (!NearbyMesh) {
    return 0
  }

  return NearbyMesh.sendMessage(JSON.stringify(message))
}

export async function broadcastMessage(message: Message): Promise<number> {
  return sendMessage(message)
}

export async function getConnectedPeerCount(): Promise<number> {
  if (!NearbyMesh) {
    return 0
  }

  return NearbyMesh.getConnectedPeerCount()
}

export async function scanNearbyPeers(): Promise<number> {
  if (!NearbyMesh) {
    return 0
  }

  try {
    await NearbyMesh.scanNow()
  } catch (error) {
    // Nearby can report "already discovering" during rapid rescan calls.
    if (!isAlreadyDiscoveringError(error)) {
      throw error
    }
  }

  return getConnectedPeerCount()
}

export function onMessageReceived(callback: (message: Message) => void): () => void {
  if (!NearbyMesh) {
    return () => {}
  }

  const emitter = new NativeEventEmitter(NearbyMesh)
  const subscription = emitter.addListener('onMessageReceived', async (data: MessageEventData) => {
    try {
      const parsed = JSON.parse(data.message) as Message
      const triage = await triageMessage(parsed.body)
      const enriched: Message = {
        ...parsed,
        priority_tier: triage.tier,
        priority_score: triage.priority_score,
      }
      callback(enriched)
    } catch (error) {
      console.error('Failed handling onMessageReceived event', error)
    }
  })

  return () => {
    subscription.remove()
  }
}

export function onPeerConnected(callback: (data: PeerData) => void): () => void {
  if (!NearbyMesh) {
    return () => {}
  }

  const emitter = new NativeEventEmitter(NearbyMesh)
  const subscription = emitter.addListener('onPeerConnected', (data: PeerData) => {
    callback(data)
  })

  return () => {
    subscription.remove()
  }
}

export function onPeerDisconnected(callback: (data: PeerData) => void): () => void {
  if (!NearbyMesh) {
    return () => {}
  }

  const emitter = new NativeEventEmitter(NearbyMesh)
  const subscription = emitter.addListener('onPeerDisconnected', (data: PeerData) => {
    callback(data)
  })

  return () => {
    subscription.remove()
  }
}
