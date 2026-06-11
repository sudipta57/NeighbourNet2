import { Audio } from 'expo-av'

interface QueueEntry {
  uri: string
  senderName: string
  durationMs: number
}

let isPlaying = false
const queue: QueueEntry[] = []
let onStatusChange: ((playing: boolean, senderName: string | null) => void) | null = null

export function setPlaybackStatusCallback(
  cb: (playing: boolean, senderName: string | null) => void,
) {
  onStatusChange = cb
}

export function enqueuePttAudio(uri: string, senderName: string, durationMs: number) {
  queue.push({ uri, senderName, durationMs })
  if (!isPlaying) {
    playNext().catch(console.error)
  }
}

async function playNext() {
  const entry = queue.shift()
  if (!entry) {
    isPlaying = false
    onStatusChange?.(false, null)
    return
  }

  isPlaying = true
  onStatusChange?.(true, entry.senderName)

  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false, // use loudspeaker
    })

    const { sound } = await Audio.Sound.createAsync(
      { uri: entry.uri },
      { shouldPlay: true, volume: 1.0 },
    )

    await new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          resolve()
        }
      })
    })

    await sound.unloadAsync()
    // IMPORTANT: Reset audio session to neutral so the next recording
    // can properly acquire the microphone. Without this, Android's audio
    // focus stays in speaker-playback mode and Recording.createAsync fails.
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: false,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    })
  } catch (e) {
    console.error('[AudioPlayer] playback error:', e)
  }

  // Brief gap between queued messages
  await new Promise<void>((r) => setTimeout(r, 200))
  playNext().catch(console.error)
}

export function clearPttQueue() {
  queue.length = 0
}
