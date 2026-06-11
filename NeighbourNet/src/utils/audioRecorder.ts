import { Audio } from 'expo-av'
import { Platform } from 'react-native'
import { PermissionsAndroid } from 'react-native'

const MAX_DURATION_MS = 5000

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 24000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.LOW,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 24000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 24000,
  },
}

let activeRecording: Audio.Recording | null = null
let autoStopTimer: ReturnType<typeof setTimeout> | null = null
let durationInterval: ReturnType<typeof setInterval> | null = null
let durationMs = 0
let onDurationUpdate: ((ms: number) => void) | null = null

export async function requestAudioPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone Permission',
        message: 'NeighbourNet needs your microphone to send voice messages.',
        buttonPositive: 'OK',
        buttonNegative: 'Cancel',
      },
    )
    return granted === PermissionsAndroid.RESULTS.GRANTED
  } catch {
    return false
  }
}

export async function startRecording(
  onDuration?: (ms: number) => void,
  onAutoStop?: (result: { uri: string; durationMs: number }) => void,
): Promise<boolean> {
  if (activeRecording) return false

  const hasPermission = await requestAudioPermission()
  if (!hasPermission) return false

  // Explicitly configure the audio session for recording.
  // On Android, allowsRecordingIOS is ignored — we must also set
  // shouldDuckAndroid so Android properly hands audio focus to the mic.
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  })

  const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS)
  activeRecording = recording
  durationMs = 0
  onDurationUpdate = onDuration ?? null

  durationInterval = setInterval(() => {
    durationMs += 100
    onDurationUpdate?.(durationMs)
  }, 100)

  autoStopTimer = setTimeout(async () => {
    const result = await stopRecording().catch(() => null)
    if (result) {
      onAutoStop?.(result)
    }
  }, MAX_DURATION_MS)

  return true
}

export async function stopRecording(): Promise<{ uri: string; durationMs: number } | null> {
  if (!activeRecording) return null

  if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null }
  if (durationInterval) { clearInterval(durationInterval); durationInterval = null }

  const recording = activeRecording
  activeRecording = null
  const capturedDuration = durationMs
  durationMs = 0
  onDurationUpdate = null

  await recording.stopAndUnloadAsync()
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: false,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  })

  const uri = recording.getURI()
  if (!uri) return null

  return { uri, durationMs: capturedDuration }
}

export function getRecordingDuration(): number {
  return durationMs
}

export function isRecording(): boolean {
  return activeRecording !== null
}
