import { getDeviceId } from '../db/database'

export async function getDeviceUUID(): Promise<string> {
  return getDeviceId()
}
