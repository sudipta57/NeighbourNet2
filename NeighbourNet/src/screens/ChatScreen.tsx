import 'react-native-get-random-values'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as Speech from 'expo-speech'
import * as Vosk from 'react-native-vosk'
import * as ImagePicker from 'expo-image-picker'
import * as Audio from 'expo-av'
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { v4 as uuidv4 } from 'uuid'
import { ChatMessage, Message } from '../types/message'
import {
  getChatHistory,
  markDelivered,
  saveChatMessage,
} from '../db/database'
import { getDeviceUUID } from '../services/appState'
import { getDisplayName, getMyFriendCode } from '../services/profileService'
import {
  onImageReceived,
  onMessageDelivered,
  onPttAudioReceived,
  sendImage,
  sendMessage,
  sendPttAudio,
} from '../services/meshService'
import useAppStore from '../store/useAppStore'
import LocationShareButton from '../components/LocationShareButton'
import LocationMapCard from '../components/LocationMapCard'
import { compressImage } from '../utils/imageCompressor'
import {
  startRecording,
  stopRecording,
  isRecording as isPttRecording,
} from '../utils/audioRecorder'
import { enqueuePttAudio, setPlaybackStatusCallback } from '../utils/audioPlayer'

// ── Bilingual strings ────────────────────────────────────────────────────────

const L = {
  holdToTalk: 'Hold to talk / কথা বলতে ধরে রাখুন',
  sendingImage: 'Sending image... / ছবি পাঠানো হচ্ছে...',
  voiceMessage: 'Voice message / ভয়েস মেসেজ',
  image: 'Image / ছবি',
  tapToReplay: 'Tap to replay / আবার শুনতে ট্যাপ করুন',
  recording: 'Recording... / রেকর্ড হচ্ছে...',
  compressing: 'Compressing... / কম্প্রেস হচ্ছে...',
  sending: 'Sending... / পাঠানো হচ্ছে...',
  imageFailed: 'Image failed to send. Retry?',
  pickImage: 'Choose from Gallery / Camera',
}

interface ChatScreenProps {
  onBack: () => void
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000)
  return `0:${secs.toString().padStart(2, '0')}`
}

const ChatScreen = ({ onBack }: ChatScreenProps) => {
  const friend = useAppStore((state) => state.activeChatFriend)
  const peerCount = useAppStore((state) => state.peerCount)
  const allChatMessages = useAppStore((state) => state.chatMessages)
  const imageTransfers = useAppStore((state) => state.imageTransfers)
  const pttState = useAppStore((state) => state.pttState)
  const pttDuration = useAppStore((state) => state.pttDuration)
  const setImageTransfer = useAppStore((state) => state.setImageTransfer)
  const clearImageTransfer = useAppStore((state) => state.clearImageTransfer)
  const setPttState = useAppStore((state) => state.setPttState)
  const setPttDuration = useAppStore((state) => state.setPttDuration)

  const messages = React.useMemo(() => {
    if (!friend) return []
    const byUUID = friend.device_uuid ? (allChatMessages[friend.device_uuid] ?? []) : []
    const byCode = allChatMessages[friend.friend_code] ?? []
    if (byUUID.length === 0) return byCode
    if (byCode.length === 0) return byUUID
    const seen = new Set<string>()
    return [...byCode, ...byUUID]
      .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
      .sort((a, b) => a.created_at - b.created_at)
  }, [allChatMessages, friend?.device_uuid, friend?.friend_code])

  const [inputText, setInputText] = useState('')
  const [myDeviceId, setMyDeviceId] = useState<string | null>(null)
  const [myDisplayName, setMyDisplayName] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [partialText, setPartialText] = useState('')
  const [isModelLoading, setIsModelLoading] = useState(true)
  const [pttSpeaker, setPttSpeaker] = useState<string | null>(null)
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null)
  const voskLoaded = useRef(false)
  const flatListRef = useRef<FlatList<ChatMessage>>(null)

  // Initialize Vosk Model
  useEffect(() => {
    setIsModelLoading(true)
    Vosk.loadModel('model-en').then(() => {
      voskLoaded.current = true
      setIsModelLoading(false)
    }).catch(() => {
      setIsModelLoading(false)
    })
    return () => { try { Vosk.unload() } catch (_) {} }
  }, [])

  // PTT playback status hook
  useEffect(() => {
    setPlaybackStatusCallback((playing, senderName) => {
      setPttSpeaker(playing ? senderName : null)
    })
    return () => setPlaybackStatusCallback(() => {})
  }, [])

  // Load identity + chat history on mount
  useEffect(() => {
    if (!friend) return
    getDeviceUUID().then(setMyDeviceId)
    getDisplayName().then(setMyDisplayName)
    const uuid = friend.device_uuid
    if (uuid) {
      const history = getChatHistory(uuid, 50)
      history.forEach((msg) => useAppStore.getState().addChatMessage(uuid, msg))
    }
  }, [friend?.device_uuid])

  // Delivery acks
  useEffect(() => {
    if (!friend?.device_uuid) return
    const uuid = friend.device_uuid
    const unsub = onMessageDelivered(({ message_id }) => {
      markDelivered(message_id)
      useAppStore.getState().markChatMessageDelivered(uuid, message_id)
    })
    return () => unsub()
  }, [friend?.device_uuid])

  // Image received
  useEffect(() => {
    if (!myDeviceId || !friend) return
    const storeKey = friend.device_uuid || friend.friend_code
    const unsub = onImageReceived(async (data) => {
      if (data.recipient_id !== myDeviceId) return
      const threadKey = `thread_${friend.friend_code}`
      let threadId = await AsyncStorage.getItem(threadKey)
      if (!threadId) {
        threadId = uuidv4()
        await AsyncStorage.setItem(threadKey, threadId)
      }
      const chatMsg: ChatMessage = {
        id: data.image_id,
        thread_id: threadId,
        friend_device_uuid: storeKey,
        body: L.image,
        sender_id: data.sender_id,
        is_outgoing: false,
        created_at: Date.now(),
        delivered: true,
        media_type: 'image',
        media_uri: data.local_uri,
        transfer_mode: data.transfer_mode,
      }
      saveChatMessage(chatMsg)
      useAppStore.getState().addChatMessage(storeKey, chatMsg)
    })
    return () => unsub()
  }, [myDeviceId, friend?.device_uuid, friend?.friend_code])

  // PTT received
  // NOTE: No recipient/sender ID filtering here. Kotlin uses ANDROID_ID for
  // sender_id/recipient_id, while JS uses expo-secure-store UUIDs — they never
  // match. Kotlin emits onPttAudioReceived on every node that receives the
  // binary payload (including relays). The addChatMessage call below is already
  // idempotent (deduplicates by message id), so duplicate events are safe.
  useEffect(() => {
    if (!friend) return
    const storeKey = friend.device_uuid || friend.friend_code
    const unsub = onPttAudioReceived(async (data) => {
      const threadKey = `thread_${friend.friend_code}`
      let threadId = await AsyncStorage.getItem(threadKey)
      if (!threadId) {
        threadId = uuidv4()
        await AsyncStorage.setItem(threadKey, threadId)
      }
      const chatMsg: ChatMessage = {
        id: data.audio_id,
        thread_id: threadId,
        friend_device_uuid: storeKey,
        body: L.voiceMessage,
        sender_id: data.sender_id,
        is_outgoing: false,
        created_at: Date.now(),
        delivered: true,
        media_type: 'ptt_audio',
        media_uri: data.local_uri,
        media_size: data.duration_ms,
      }
      saveChatMessage(chatMsg)
      useAppStore.getState().addChatMessage(storeKey, chatMsg)
      // Auto-play
      enqueuePttAudio(data.local_uri, friend.display_name, data.duration_ms)
    })
    return () => unsub()
  }, [friend?.device_uuid, friend?.friend_code, friend?.display_name])

  // Vosk speech events
  useEffect(() => {
    const onPartial = DeviceEventEmitter.addListener('onPartialResult', (data: string) => {
      try { setPartialText(data || '') } catch (_) {}
    })
    const onResult = DeviceEventEmitter.addListener('onResult', (data: string) => {
      try {
        if (data) setInputText((prev) => (prev ? prev + ' ' + data : data).trim())
      } catch (_) {}
    })
    const onFinal = DeviceEventEmitter.addListener('onFinalResult', (data: string) => {
      try {
        if (data) setInputText((prev) => (prev ? prev + ' ' + data : data).trim())
      } catch (_) {}
    })
    const onError = DeviceEventEmitter.addListener('onError', () => {
      setIsListening(false)
      setPartialText('')
    })
    return () => { onPartial.remove(); onResult.remove(); onFinal.remove(); onError.remove() }
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (messages.length === 0) return
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50)
  }, [messages.length])

  const handlePlayTTS = (text: string) => {
    Speech.stop()
    Speech.speak(text, { language: 'en-US' })
  }

  const requestAudioPermission = async () => {
    if (Platform.OS !== 'android') return true
    const { PermissionsAndroid } = require('react-native')
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone Permission',
        message: 'NeighbourNet needs access to your microphone to convert speech to text.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      }
    )
    return granted === PermissionsAndroid.RESULTS.GRANTED
  }

  const toggleListening = async () => {
    if (!voskLoaded.current) return
    if (isListening) {
      try { Vosk.stop() } catch (_) {}
      setIsListening(false)
      setPartialText('')
    } else {
      const hasPermission = await requestAudioPermission()
      if (!hasPermission) return
      try {
        setInputText('')
        setPartialText('')
        await Vosk.start()
        setIsListening(true)
      } catch (_) {
        setIsListening(false)
      }
    }
  }

  // ── Image send ────────────────────────────────────────────────────────────

  const handlePickImage = async () => {
    if (!myDeviceId || !friend) return

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Gallery access is required to send images.')
      return
    }

    Alert.alert(L.pickImage, '', [
      {
        text: '📷 Camera',
        onPress: async () => {
          const cam = await ImagePicker.requestCameraPermissionsAsync()
          if (cam.status !== 'granted') return
          const result = await ImagePicker.launchCameraAsync({ quality: 1 })
          if (!result.canceled && result.assets[0]) {
            await sendImageFromUri(result.assets[0].uri)
          }
        },
      },
      {
        text: '🖼 Gallery',
        onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({ quality: 1, mediaTypes: ImagePicker.MediaTypeOptions.Images })
          if (!result.canceled && result.assets[0]) {
            await sendImageFromUri(result.assets[0].uri)
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const sendImageFromUri = async (uri: string) => {
    if (!myDeviceId || !friend) return
    const imageId = uuidv4()
    const storeKey = friend.device_uuid || friend.friend_code
    const threadKey = `thread_${friend.friend_code}`
    let threadId = await AsyncStorage.getItem(threadKey)
    if (!threadId) {
      threadId = uuidv4()
      await AsyncStorage.setItem(threadKey, threadId)
    }

    // Optimistic UI: show compressing state with placeholder
    setImageTransfer(imageId, { status: 'compressing', progress: 0 })
    const placeholderMsg: ChatMessage = {
      id: imageId,
      thread_id: threadId,
      friend_device_uuid: storeKey,
      body: L.image,
      sender_id: myDeviceId,
      is_outgoing: true,
      created_at: Date.now(),
      delivered: false,
      media_type: 'image',
      media_uri: uri, // show original while compressing
    }
    saveChatMessage(placeholderMsg)
    useAppStore.getState().addChatMessage(storeKey, placeholderMsg)

    try {
      setImageTransfer(imageId, { status: 'compressing', progress: 10 })
      const { highQuality, lowQuality } = await compressImage(uri)

      setImageTransfer(imageId, { status: 'sending', progress: 50 })
      const result = await sendImage(
        friend.device_uuid || friend.friend_code,
        highQuality,
        lowQuality,
      )

      setImageTransfer(imageId, { status: 'sent', progress: 100 })
      setTimeout(() => clearImageTransfer(imageId), 3000)
    } catch (e) {
      console.error('[Chat] sendImage failed:', e)
      setImageTransfer(imageId, { status: 'failed', progress: 0 })
    }
  }

  // ── PTT ──────────────────────────────────────────────────────────────────

  // Stores the result when the 5-sec auto-stop timer fires before onPressOut.
  const autoStoppedResultRef = useRef<{ uri: string; durationMs: number } | null>(null)

  const handlePttPressIn = useCallback(async () => {
    if (!myDeviceId || !friend) return
    if (pttState !== 'idle') return

    autoStoppedResultRef.current = null
    setPttState('recording')
    setPttDuration(0)
    const started = await startRecording(
      (ms) => setPttDuration(ms),
      // onAutoStop: called when the 5-sec cap fires inside audioRecorder
      (result) => { autoStoppedResultRef.current = result },
    )
    if (!started) {
      setPttState('idle')
    }
  }, [myDeviceId, friend, pttState])

  const handlePttPressOut = useCallback(async () => {
    // If the 5-sec auto-stop already fired, use its result rather than
    // calling stopRecording() again (which would return null).
    let result: { uri: string; durationMs: number } | null = null
    if (autoStoppedResultRef.current) {
      result = autoStoppedResultRef.current
      autoStoppedResultRef.current = null
    } else if (isPttRecording()) {
      setPttState('encoding')
      result = await stopRecording()
    } else {
      // Not recording and no auto-stopped result — nothing to send.
      setPttState('idle')
      return
    }

    if (!result || !myDeviceId || !friend) {
      setPttState('idle')
      return
    }

    const { uri, durationMs: dur } = result
    if (dur < 300) {
      // Too short, ignore
      setPttState('idle')
      return
    }

    const audioId = uuidv4()
    const storeKey = friend.device_uuid || friend.friend_code
    const threadKey = `thread_${friend.friend_code}`
    let threadId = await AsyncStorage.getItem(threadKey)
    if (!threadId) {
      threadId = uuidv4()
      await AsyncStorage.setItem(threadKey, threadId)
    }

    const chatMsg: ChatMessage = {
      id: audioId,
      thread_id: threadId,
      friend_device_uuid: storeKey,
      body: L.voiceMessage,
      sender_id: myDeviceId,
      is_outgoing: true,
      created_at: Date.now(),
      delivered: false,
      media_type: 'ptt_audio',
      media_uri: uri,
      media_size: dur,
    }
    saveChatMessage(chatMsg)
    useAppStore.getState().addChatMessage(storeKey, chatMsg)

    try {
      setPttState('sending')
      await sendPttAudio(
        friend.device_uuid || friend.friend_code,
        uri,
        dur,
      )
    } catch (e) {
      console.error('[Chat] sendPttAudio failed:', e)
    } finally {
      setPttState('idle')
      setPttDuration(0)
    }
  }, [myDeviceId, friend, pttState])

  // ── Location share ────────────────────────────────────────────────────────

  const handleLocationShare = useCallback(async (lat: number, lng: number, label: string) => {
    if (!myDeviceId || !friend) return

    const threadKey = `thread_${friend.friend_code}`
    let threadId = await AsyncStorage.getItem(threadKey)
    if (!threadId) {
      threadId = uuidv4()
      await AsyncStorage.setItem(threadKey, threadId)
    }

    const storeKey = friend.device_uuid || friend.friend_code
    const myCode = await getMyFriendCode()
    const nowIso = new Date().toISOString()

    const chatMsg: ChatMessage = {
      id: uuidv4(),
      thread_id: threadId,
      friend_device_uuid: storeKey,
      body: `📍 Location: ${label}`,
      sender_id: myDeviceId,
      is_outgoing: true,
      created_at: Date.now(),
      delivered: false,
      shared_lat: lat,
      shared_lng: lng,
      shared_location_label: label,
    }

    saveChatMessage(chatMsg)
    useAppStore.getState().addChatMessage(storeKey, chatMsg)

    const meshMessage: Message = {
      message_id: chatMsg.id,
      body: chatMsg.body,
      sender_id: myDeviceId,
      sender_name: myDisplayName,
      destination_id: friend.device_uuid || undefined,
      location_hint: myCode,
      chat_thread_id: threadId,
      message_type: 'gps_share',
      shared_lat: lat,
      shared_lng: lng,
      shared_location_label: label,
      priority_tier: 'LOW',
      priority_score: 0,
      ttl: 10,
      hop_count: 0,
      created_at: nowIso,
      last_hop_at: nowIso,
      synced: false,
      gps_lat: lat,
      gps_lng: lng,
    }

    try { await sendMessage(meshMessage) } catch (e) { console.error('[Chat] location send failed:', e) }
  }, [myDeviceId, myDisplayName, friend])

  // ── Text send ────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const body = inputText.trim()
    if (!body || !myDeviceId || !friend) return

    setInputText('')

    const threadKey = `thread_${friend.friend_code}`
    let threadId = await AsyncStorage.getItem(threadKey)
    if (!threadId) {
      threadId = uuidv4()
      await AsyncStorage.setItem(threadKey, threadId)
    }

    const msgId = uuidv4()
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const storeKey = friend.device_uuid || friend.friend_code

    const chatMsg: ChatMessage = {
      id: msgId,
      thread_id: threadId,
      friend_device_uuid: storeKey,
      body,
      sender_id: myDeviceId,
      is_outgoing: true,
      created_at: now,
      delivered: false,
    }

    saveChatMessage(chatMsg)
    useAppStore.getState().addChatMessage(storeKey, chatMsg)

    const myCode = await getMyFriendCode()
    const meshMessage: Message = {
      message_id: msgId,
      body,
      sender_id: myDeviceId,
      sender_name: myDisplayName,
      destination_id: friend.device_uuid || undefined,
      chat_thread_id: threadId,
      message_type: 'chat',
      location_hint: myCode,
      priority_tier: 'LOW',
      priority_score: 0,
      ttl: 10,
      hop_count: 0,
      created_at: nowIso,
      last_hop_at: nowIso,
      synced: false,
      gps_lat: null,
      gps_lng: null,
    }

    try { await sendMessage(meshMessage) } catch (e) { console.error('[Chat] sendMessage failed:', e) }
  }, [inputText, myDeviceId, myDisplayName, friend, peerCount])

  // ── Replay PTT ────────────────────────────────────────────────────────────

  const handleReplayPtt = (uri: string, durationMs: number) => {
    if (!uri || !friend) return
    enqueuePttAudio(uri, friend.display_name, durationMs)
  }

  // ── Message rendering ────────────────────────────────────────────────────

  if (!friend) return null

  const isOnline =
    friend.last_seen_at !== null &&
    Date.now() - friend.last_seen_at < 5 * 60 * 1000

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isLocationShare = item.shared_lat != null && item.shared_lng != null
    const isImage = item.media_type === 'image'
    const isPtt = item.media_type === 'ptt_audio'
    const transfer = item.id ? imageTransfers[item.id] : undefined

    if (item.is_outgoing) {
      return (
        <View style={styles.rowRight}>
          <View style={[styles.bubbleOut, (isLocationShare || isImage) && styles.bubbleMedia]}>
            {isImage && item.media_uri ? (
              <TouchableOpacity onPress={() => setFullScreenImage(item.media_uri!)}>
                <Image source={{ uri: item.media_uri }} style={styles.imageBubble} resizeMode="cover" />
                {transfer && transfer.status !== 'sent' && (
                  <View style={styles.imageOverlay}>
                    <Text style={styles.imageOverlayText}>
                      {transfer.status === 'compressing'
                        ? L.compressing
                        : transfer.status === 'sending'
                        ? L.sending
                        : transfer.status === 'failed'
                        ? '✕ Failed'
                        : ''}
                    </Text>
                    {transfer.status !== 'failed' && (
                      <ActivityIndicator size="small" color="#FFFFFF" style={{ marginTop: 4 }} />
                    )}
                  </View>
                )}
              </TouchableOpacity>
            ) : isPtt ? (
              <View style={styles.pttBubble}>
                <Text style={styles.pttIcon}>🎙</Text>
                <View>
                  <Text style={styles.bubbleTextOut}>{L.voiceMessage}</Text>
                  {item.media_size ? (
                    <Text style={styles.pttDurationText}>{formatDuration(item.media_size)}</Text>
                  ) : null}
                </View>
              </View>
            ) : isLocationShare ? (
              <LocationMapCard
                latitude={item.shared_lat!}
                longitude={item.shared_lng!}
                label={item.shared_location_label ?? `${item.shared_lat}, ${item.shared_lng}`}
                isOutgoing={true}
              />
            ) : (
              <View style={styles.bubbleTextRow}>
                <Text style={styles.bubbleTextOut}>{item.body}</Text>
                <TouchableOpacity onPress={() => handlePlayTTS(item.body)} style={styles.ttsBtn}>
                  <Text style={styles.ttsIcon}>🔊</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.metaRow}>
              <Text style={styles.timeOut}>{formatTime(item.created_at)}</Text>
              <Text style={[styles.tick, item.delivered ? styles.tickDelivered : styles.tickPending]}>
                {item.delivered ? '✓✓' : '✓'}
              </Text>
            </View>
          </View>
        </View>
      )
    }

    return (
      <View style={styles.rowLeft}>
        <Text style={styles.senderName}>{friend.display_name}</Text>
        <View style={[styles.bubbleIn, (isLocationShare || isImage) && styles.bubbleMedia]}>
          {isImage && item.media_uri ? (
            <TouchableOpacity onPress={() => setFullScreenImage(item.media_uri!)}>
              <Image source={{ uri: item.media_uri }} style={styles.imageBubble} resizeMode="cover" />
            </TouchableOpacity>
          ) : isPtt ? (
            <TouchableOpacity
              style={styles.pttBubble}
              onPress={() => item.media_uri && handleReplayPtt(item.media_uri, item.media_size ?? 0)}
            >
              <Text style={styles.pttIcon}>▶</Text>
              <View>
                <Text style={styles.bubbleTextIn}>{L.voiceMessage}</Text>
                {item.media_size ? (
                  <Text style={styles.pttDurationText}>{formatDuration(item.media_size)}</Text>
                ) : null}
                <Text style={styles.tapToReplayText}>{L.tapToReplay}</Text>
              </View>
            </TouchableOpacity>
          ) : isLocationShare ? (
            <LocationMapCard
              latitude={item.shared_lat!}
              longitude={item.shared_lng!}
              label={item.shared_location_label ?? `${item.shared_lat}, ${item.shared_lng}`}
              isOutgoing={false}
            />
          ) : (
            <View style={styles.bubbleTextRow}>
              <Text style={styles.bubbleTextIn}>{item.body}</Text>
              <TouchableOpacity onPress={() => handlePlayTTS(item.body)} style={styles.ttsBtnIn}>
                <Text style={styles.ttsIcon}>🔊</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.timeIn}>{formatTime(item.created_at)}</Text>
        </View>
      </View>
    )
  }

  // ── PTT button label ──────────────────────────────────────────────────────

  const pttActive = pttState === 'recording'
  const pttBusy = pttState !== 'idle'

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.root} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onBack}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerName} numberOfLines={1}>
              {friend.display_name}
            </Text>
            <Text style={styles.headerCode}>Code: {friend.friend_code}</Text>
            <Text style={[styles.peerStatus, { color: peerCount > 0 ? '#81C784' : '#FF8A65' }]}>
              {peerCount > 0 ? `${peerCount} peer${peerCount > 1 ? 's' : ''} connected` : 'No peers — move closer'}
            </Text>
          </View>

          <View
            style={[
              styles.statusDot,
              { backgroundColor: isOnline ? '#4CAF50' : '#9E9E9E' },
            ]}
          />
        </View>

        {/* PTT speaking overlay */}
        {pttSpeaker && (
          <View style={styles.pttOverlay}>
            <Text style={styles.pttOverlayText}>🔊 {pttSpeaker} is speaking...</Text>
          </View>
        )}

        {/* Message list */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No messages yet. Say hello!</Text>
            </View>
          }
        />

        {/* Input bar */}
        <View style={styles.inputBar}>
          <LocationShareButton onLocationShared={handleLocationShare} />

          {/* Image button */}
          <TouchableOpacity style={styles.imageBtn} onPress={handlePickImage}>
            <Text style={styles.imageBtnIcon}>📷</Text>
          </TouchableOpacity>

          {/* Mic / STT button */}
          <TouchableOpacity
            style={[
              styles.micBtn,
              isListening && styles.micBtnActive,
              !voskLoaded.current && styles.micBtnDisabled,
            ]}
            onPress={toggleListening}
            disabled={isModelLoading}
          >
            {isModelLoading ? (
              <ActivityIndicator size="small" color="#1565C0" />
            ) : (
              <Text style={styles.micIcon}>{isListening ? '⏹' : '🎤'}</Text>
            )}
          </TouchableOpacity>

          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder={
              pttActive
                ? `${L.recording} ${formatDuration(pttDuration)}`
                : pttBusy
                ? L.sending
                : isListening
                ? (partialText || 'Listening...')
                : 'Type a message...'
            }
            placeholderTextColor={pttActive ? '#FF5252' : isListening ? '#1565C0' : 'rgba(0,0,0,0.35)'}
            multiline
            maxLength={500}
            editable={!pttBusy}
          />

          <TouchableOpacity
            style={[
              styles.sendBtn,
              !inputText.trim() && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || pttBusy}
            activeOpacity={0.8}
          >
            <Text style={styles.sendBtnText}>→</Text>
          </TouchableOpacity>

          {/* PTT button */}
          <TouchableOpacity
            style={[styles.pttBtn, pttActive && styles.pttBtnActive]}
            onPressIn={handlePttPressIn}
            onPressOut={handlePttPressOut}
            disabled={isListening}
            activeOpacity={0.8}
          >
            <Text style={styles.pttBtnIcon}>{pttActive ? '⏺' : '📢'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Full-screen image viewer */}
      <Modal visible={fullScreenImage !== null} transparent animationType="fade">
        <TouchableOpacity
          style={styles.fullScreenBg}
          onPress={() => setFullScreenImage(null)}
          activeOpacity={1}
        >
          {fullScreenImage && (
            <Image
              source={{ uri: fullScreenImage }}
              style={styles.fullScreenImage}
              resizeMode="contain"
            />
          )}
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: '#ECEFF1' },

  // ── Header ──────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A237E',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  backBtn: { paddingRight: 8 },
  backArrow: { color: '#FFFFFF', fontSize: 24, lineHeight: 28 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerName: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  headerCode: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  peerStatus: { fontSize: 11, marginTop: 2 },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginLeft: 8 },

  // ── PTT overlay ──────────────────────────────────────────
  pttOverlay: {
    backgroundColor: '#1A237E',
    paddingHorizontal: 16,
    paddingVertical: 6,
    alignItems: 'center',
  },
  pttOverlayText: { color: '#81C784', fontSize: 13, fontWeight: '600' },

  // ── Message list ─────────────────────────────────────────
  list: { flex: 1 },
  listContent: { paddingVertical: 12, paddingHorizontal: 12, flexGrow: 1 },
  emptyContainer: { flex: 1, alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#9E9E9E', fontSize: 14 },

  // ── Outgoing bubble ──────────────────────────────────────
  rowRight: { alignItems: 'flex-end', marginBottom: 8 },
  bubbleOut: {
    backgroundColor: '#1565C0',
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '75%',
  },
  bubbleMedia: { paddingHorizontal: 4, paddingVertical: 4 },
  bubbleTextOut: { color: '#FFFFFF', fontSize: 15, lineHeight: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 },
  timeOut: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
  tick: { fontSize: 11 },
  tickPending: { color: 'rgba(255,255,255,0.45)' },
  tickDelivered: { color: '#90CAF9' },

  // ── Incoming bubble ──────────────────────────────────────
  rowLeft: { alignItems: 'flex-start', marginBottom: 8 },
  senderName: { color: '#9E9E9E', fontSize: 11, marginBottom: 3, marginLeft: 4 },
  bubbleIn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '75%',
  },
  bubbleTextIn: { color: '#212121', fontSize: 15, lineHeight: 20 },
  timeIn: { color: '#9E9E9E', fontSize: 11, marginTop: 4 },

  // ── Image bubble ─────────────────────────────────────────
  imageBubble: { width: 220, height: 160, borderRadius: 12 },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageOverlayText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', textAlign: 'center' },

  // ── PTT bubble ───────────────────────────────────────────
  pttBubble: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingHorizontal: 2 },
  pttIcon: { fontSize: 22 },
  pttDurationText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  tapToReplayText: { color: '#9E9E9E', fontSize: 11, marginTop: 2 },

  // ── Input bar ────────────────────────────────────────────
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    gap: 4,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 15,
    color: '#212121',
    maxHeight: 120,
    backgroundColor: '#F5F5F5',
  },
  sendBtn: {
    backgroundColor: '#1565C0',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.35 },
  sendBtnText: { color: '#FFFFFF', fontSize: 20 },

  // ── Image button ─────────────────────────────────────────
  imageBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageBtnIcon: { fontSize: 18 },

  // ── Mic button ───────────────────────────────────────────
  micBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnDisabled: { opacity: 0.5 },
  micBtnActive: { backgroundColor: '#FF5252' },
  micIcon: { fontSize: 18 },

  // ── PTT button ───────────────────────────────────────────
  pttBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1565C0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  pttBtnActive: { backgroundColor: '#FF5252', transform: [{ scale: 1.1 }] },
  pttBtnIcon: { fontSize: 20 },

  // ── Common ───────────────────────────────────────────────
  bubbleTextRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  ttsBtn: { marginLeft: 8, padding: 2 },
  ttsBtnIn: { marginLeft: 8, padding: 2 },
  ttsIcon: { fontSize: 16 },

  // ── Full-screen image ─────────────────────────────────────
  fullScreenBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreenImage: { width: '100%', height: '100%' },
})

export default ChatScreen
