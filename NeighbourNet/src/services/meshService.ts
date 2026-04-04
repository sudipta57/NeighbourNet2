import { NativeEventEmitter, NativeModules, Platform } from 'react-native'
import type { NativeModule } from 'react-native'
import { triageMessage } from './triageEngine'
import type { Message } from '../types/message'
import useMeshStore from '../store/meshStore'

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

const MESH_CALL_TIMEOUT_MS = 8000

const withTimeout = async <T>(label: string, operation: Promise<T>, timeoutMs = MESH_CALL_TIMEOUT_MS): Promise<T> => {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}

export async function startMesh(): Promise<void> {
  if (!NearbyMesh) {
    console.warn(`NearbyMesh: native module not available on ${Platform.OS}, skipping mesh start`)
    return
  }

  await withTimeout('startMesh', NearbyMesh.startMesh())
}

export async function stopMesh(): Promise<void> {
  if (!NearbyMesh) {
    return
  }

  await NearbyMesh.stopMesh()
}

export async function sendMessage(message: Message): Promise<number> {
  if (!NearbyMesh) {
    console.warn('[NearbyMesh] module not available')
    return 0
  }
  try {
    const json = JSON.stringify(message)
    console.log('[NearbyMesh] sendMessage called, size:', json.length, 'bytes')
    const result = await NearbyMesh.sendMessage(json)
    if (result > 0) {
      useMeshStore.getState().incrementRelayed()
    }
    console.log('[NearbyMesh] sendMessage result — sent to peers:', result)
    return result
  } catch (e) {
    console.error('[NearbyMesh] sendMessage error:', e)
    return 0
  }
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
    await withTimeout('scanNow', NearbyMesh.scanNow())
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

// CHANGE 6: Delivery acknowledgement listener.
export function onMessageDelivered(
  callback: (data: { message_id: string }) => void
): () => void {
  if (!NearbyMesh) return () => {}
  const emitter = new NativeEventEmitter(NearbyMesh)
  const sub = emitter.addListener('onMessageDelivered', (data: MessageEventData) => {
    try {
      const parsed = JSON.parse(data.message) as { message_id: string }
      callback({ message_id: parsed.message_id })
    } catch (error) {
      console.error('Failed handling onMessageDelivered event', error)
    }
  })
  return () => sub.remove()
}
