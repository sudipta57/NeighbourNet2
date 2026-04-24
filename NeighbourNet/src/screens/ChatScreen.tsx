import 'react-native-get-random-values'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as Speech from 'expo-speech'
import * as Vosk from 'react-native-vosk'
import {
  FlatList,
  KeyboardAvoidingView,
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
  onMessageDelivered,
  sendMessage,
} from '../services/meshService'
import useAppStore from '../store/useAppStore'
import LocationShareButton from '../components/LocationShareButton'
import LocationMapCard from '../components/LocationMapCard'

interface ChatScreenProps {
  onBack: () => void
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

const ChatScreen = ({ onBack }: ChatScreenProps) => {
  const friend = useAppStore((state) => state.activeChatFriend)
  const peerCount = useAppStore((state) => state.peerCount)
  const allChatMessages = useAppStore((state) => state.chatMessages)
  // Merge messages stored under UUID key and friend_code key.
  // During UUID discovery, some messages may land under the code, some under the UUID.
  const messages = React.useMemo(() => {
    if (!friend) return []
    const byUUID = friend.device_uuid ? (allChatMessages[friend.device_uuid] ?? []) : []
    const byCode = allChatMessages[friend.friend_code] ?? []
    if (byUUID.length === 0) return byCode
    if (byCode.length === 0) return byUUID
    // Merge + dedup, preserving order
    const seen = new Set<string>()
    return [...byCode, ...byUUID]
      .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
      .sort((a, b) => a.created_at - b.created_at)
  }, [allChatMessages, friend?.device_uuid, friend?.friend_code])

  const [inputText, setInputText] = useState('')
  const [myDeviceId, setMyDeviceId] = useState<string | null>(null)
  const [myDisplayName, setMyDisplayName] = useState('')
  const [isListening, setIsListening] = useState(false)
  const voskLoaded = useRef(false)

  const flatListRef = useRef<FlatList<ChatMessage>>(null)

  // Initialize Vosk Model
  useEffect(() => {
    Vosk.loadModel('model-en').then(() => {
      console.log('[Chat] Vosk model loaded')
      voskLoaded.current = true
    }).catch(e => console.log('[Chat] Vosk load error:', e))

    return () => {
      if (voskLoaded.current) {
        Vosk.unload()
      }
    }
  }, [])

  const toggleListening = async () => {
    if (!voskLoaded.current) {
      console.warn('Vosk model not loaded yet')
      return
    }

    if (isListening) {
      Vosk.stop()
      setIsListening(false)
    } else {
      try {
        setIsListening(true)
        Vosk.start()
        Vosk.onResult((res: any) => {
          if (res.text) {
            setInputText((prev) => {
              const newText = prev ? prev + ' ' + res.text : res.text
              return newText.trim()
            })
          }
        })
        Vosk.onError((e: any) => {
          console.error('[Chat] Vosk error', e)
          setIsListening(false)
        })
      } catch (e) {
        console.error('[Chat] Vosk start error', e)
        setIsListening(false)
      }
    }
  }

  const handlePlayTTS = (text: string) => {
    Speech.stop() // stop any ongoing speech
    Speech.speak(text, { language: 'en-US' })
  }

  // Load identity and chat history on mount. Re-runs when UUID becomes known (Fix C).
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

  // Subscribe to delivery acks — mark matching outgoing messages as delivered.
  useEffect(() => {
    if (!friend?.device_uuid) return
    const uuid = friend.device_uuid
    const unsub = onMessageDelivered(({ message_id }) => {
      markDelivered(message_id)
      useAppStore.getState().markChatMessageDelivered(uuid, message_id)
    })
    return () => unsub()
  }, [friend?.device_uuid])

  // Auto-scroll to bottom whenever the message list grows.
  useEffect(() => {
    if (messages.length === 0) return
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true })
    }, 50)
  }, [messages.length])

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

    try {
      await sendMessage(meshMessage)
    } catch (e) {
      console.error('[Chat] sendMessage (location) failed:', e)
    }
    console.log('[Chat] Location shared:', lat, lng)
  }, [myDeviceId, myDisplayName, friend])

  const handleSend = useCallback(async () => {
    const body = inputText.trim()
    if (!body || !myDeviceId || !friend) return

    setInputText('')

    // Use friend_code-based thread key so it survives UUID being unknown initially
    const threadKey = `thread_${friend.friend_code}`
    let threadId = await AsyncStorage.getItem(threadKey)
    if (!threadId) {
      threadId = uuidv4()
      await AsyncStorage.setItem(threadKey, threadId)
    }

    const msgId = uuidv4()
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    // Use friend_code as fallback store key when UUID not yet known
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
      // If UUID unknown: omit destination_id so message broadcasts to all peers
      destination_id: friend.device_uuid || undefined,
      chat_thread_id: threadId,
      message_type: 'chat',
      // Carry our friend code so the recipient can link our UUID to our code
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

    console.log('[Chat] Sending to:', friend.device_uuid || '(broadcast)', 'peers:', peerCount)
    try {
      const result = await sendMessage(meshMessage)
      console.log('[Chat] sendMessage returned:', result)
    } catch (e) {
      console.error('[Chat] sendMessage failed:', e)
    }
  }, [inputText, myDeviceId, myDisplayName, friend, peerCount])

  if (!friend) return null

  const isOnline =
    friend.last_seen_at !== null &&
    Date.now() - friend.last_seen_at < 5 * 60 * 1000

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isLocationShare = item.shared_lat != null && item.shared_lng != null

    if (item.is_outgoing) {
      return (
        <View style={styles.rowRight}>
          <View style={[styles.bubbleOut, isLocationShare && styles.bubbleMap]}>
            {isLocationShare ? (
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
        <View style={[styles.bubbleIn, isLocationShare && styles.bubbleMap]}>
          {isLocationShare ? (
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
          
          <TouchableOpacity
            style={[styles.micBtn, isListening && styles.micBtnActive]}
            onPress={toggleListening}
          >
            <Text style={styles.micIcon}>{isListening ? '⏹' : '🎤'}</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder={isListening ? "Listening..." : "Type a message..."}
            placeholderTextColor="rgba(0,0,0,0.35)"
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              !inputText.trim() && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!inputText.trim()}
            activeOpacity={0.8}
          >
            <Text style={styles.sendBtnText}>→</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  root: {
    flex: 1,
    backgroundColor: '#ECEFF1',
  },

  // ── Header ──────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A237E',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  backBtn: {
    paddingRight: 8,
  },
  backArrow: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 28,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerName: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  headerCode: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 2,
  },
  peerStatus: {
    fontSize: 11,
    marginTop: 2,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: 8,
  },

  // ── Message list ─────────────────────────────────────────
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    color: '#9E9E9E',
    fontSize: 14,
  },

  // ── Outgoing bubble ──────────────────────────────────────
  rowRight: {
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  bubbleOut: {
    backgroundColor: '#1565C0',
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '75%',
  },
  bubbleMap: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  bubbleTextOut: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  timeOut: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
  },
  tick: {
    fontSize: 11,
  },
  tickPending: {
    color: 'rgba(255,255,255,0.45)',
  },
  tickDelivered: {
    color: '#90CAF9',
  },

  // ── Incoming bubble ──────────────────────────────────────
  rowLeft: {
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  senderName: {
    color: '#9E9E9E',
    fontSize: 11,
    marginBottom: 3,
    marginLeft: 4,
  },
  bubbleIn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '75%',
  },
  bubbleTextIn: {
    color: '#212121',
    fontSize: 15,
    lineHeight: 20,
  },
  timeIn: {
    color: '#9E9E9E',
    fontSize: 11,
    marginTop: 4,
  },

  // ── Input bar ────────────────────────────────────────────
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
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
    marginLeft: 8,
    backgroundColor: '#1565C0',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.35,
  },
  sendBtnText: {
    color: '#FFFFFF',
    fontSize: 22,
  },
  bubbleTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  ttsBtn: {
    marginLeft: 8,
    padding: 2,
  },
  ttsBtnIn: {
    marginLeft: 8,
    padding: 2,
  },
  ttsIcon: {
    fontSize: 16,
  },
  micBtn: {
    marginRight: 8,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnActive: {
    backgroundColor: '#FF5252',
  },
  micIcon: {
    fontSize: 18,
  },
})

export default ChatScreen
