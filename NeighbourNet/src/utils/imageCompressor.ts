import * as ImageManipulator from 'expo-image-manipulator'
import * as FileSystem from 'expo-file-system'

const HIGH_MAX_BYTES = 300 * 1024  // 300 KB
const LOW_MAX_BYTES = 120 * 1024   // 120 KB
const HIGH_MAX_WIDTH = 1200
const LOW_MAX_WIDTH = 600
const MIN_QUALITY = 0.2

async function getFileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri)
  return info.exists && 'size' in info ? (info.size ?? 0) : 0
}

async function compressTier(
  uri: string,
  maxWidth: number,
  startQuality: number,
  maxBytes: number,
): Promise<string> {
  // First pass: compress at startQuality with no resize to discover source width
  let result = await ImageManipulator.manipulateAsync(
    uri,
    [],
    { compress: startQuality, format: ImageManipulator.SaveFormat.JPEG },
  )
  const sourceWidth = result.width
  const effectiveMaxWidth = Math.min(maxWidth, sourceWidth)
  const needsResize = sourceWidth > maxWidth

  let size = await getFileSize(result.uri)
  if (size <= maxBytes) return result.uri

  let quality = startQuality
  while (quality >= MIN_QUALITY) {
    const actions: ImageManipulator.Action[] = needsResize
      ? [{ resize: { width: effectiveMaxWidth } }]
      : []
    result = await ImageManipulator.manipulateAsync(
      uri,
      actions,
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
    )
    size = await getFileSize(result.uri)
    if (size <= maxBytes) return result.uri
    quality = parseFloat((quality - 0.1).toFixed(1))
  }

  return result.uri
}

export async function compressImage(uri: string): Promise<{ highQuality: string; lowQuality: string }> {
  const highQuality = await compressTier(uri, HIGH_MAX_WIDTH, 0.7, HIGH_MAX_BYTES)

  const highSize = await getFileSize(highQuality)
  if (highSize <= LOW_MAX_BYTES) {
    return { highQuality, lowQuality: highQuality }
  }

  const lowQuality = await compressTier(uri, LOW_MAX_WIDTH, 0.4, LOW_MAX_BYTES)
  return { highQuality, lowQuality }
}
