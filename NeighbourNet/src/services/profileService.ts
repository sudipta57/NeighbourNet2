import AsyncStorage from '@react-native-async-storage/async-storage'
import { getDeviceUUID } from './appState'

export function generateFriendCode(deviceUUID: string): string {
  const clean = deviceUUID.replace(/-/g, '')
  const hex = clean.slice(-8)
  const num = parseInt(hex, 16) % 10000
  return num.toString().padStart(4, '0')
}

export async function getMyFriendCode(): Promise<string> {
  const uuid = await getDeviceUUID()
  return generateFriendCode(uuid)
}

export async function getDisplayName(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem('display_name')
    if (stored) return stored
  } catch {}
  const code = await getMyFriendCode()
  return `User ${code}`
}

export async function setDisplayName(name: string): Promise<void> {
  await AsyncStorage.setItem('display_name', name)
}

export function isValidFriendCode(code: string): boolean {
  return /^\d{4}$/.test(code.trim())
}
