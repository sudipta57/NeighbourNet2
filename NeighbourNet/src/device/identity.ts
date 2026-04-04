import { getDeviceId as getStoredDeviceId } from '../db/database'

export async function getDeviceId(): Promise<string> {
  return getStoredDeviceId()
}
