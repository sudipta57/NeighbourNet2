import AsyncStorage from '@react-native-async-storage/async-storage'
import { getAllMessages } from '../db/database'
import { broadcastMessage, getConnectedPeerCount } from './meshService'

const PENDING_MESH_IDS_KEY = 'neighbournet.pending_mesh_ids'

const readPendingIds = async (): Promise<string[]> => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_MESH_IDS_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((value): value is string => typeof value === 'string')
  } catch (error) {
    console.error('Failed to read pending mesh ids:', error)
    return []
  }
}

const writePendingIds = async (ids: string[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(PENDING_MESH_IDS_KEY, JSON.stringify(ids))
  } catch (error) {
    console.error('Failed to persist pending mesh ids:', error)
  }
}

export const enqueuePendingMeshForward = async (messageId: string): Promise<void> => {
  const current = await readPendingIds()
  if (current.includes(messageId)) {
    return
  }

  current.push(messageId)
  await writePendingIds(current)
}

export const flushPendingMeshForwards = async (): Promise<{ attempted: number; forwarded: number }> => {
  const peerCount = await getConnectedPeerCount()
  if (peerCount <= 0) {
    return { attempted: 0, forwarded: 0 }
  }

  const pendingIds = await readPendingIds()
  if (pendingIds.length === 0) {
    return { attempted: 0, forwarded: 0 }
  }

  const messages = getAllMessages()
  const messageById = new Map(messages.map((message) => [message.message_id, message]))

  let attempted = 0
  let forwarded = 0
  const remainingIds: string[] = []

  for (const id of pendingIds) {
    const message = messageById.get(id)

    if (!message) {
      continue
    }

    if (message.hop_count >= message.ttl) {
      continue
    }

    attempted += 1

    try {
      const recipients = await broadcastMessage(message)
      if (recipients > 0) {
        forwarded += 1
      } else {
        remainingIds.push(id)
      }
    } catch (error) {
      console.error('Failed forwarding pending SOS over mesh:', error)
      remainingIds.push(id)
    }
  }

  if (remainingIds.length !== pendingIds.length) {
    await writePendingIds(remainingIds)
  }

  return { attempted, forwarded }
}
