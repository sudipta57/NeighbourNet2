import 'react-native-get-random-values'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { v4 as uuidv4 } from 'uuid'
import { ChatMessage, Message } from '../types/message'
import {
  getChatHistory,
  markDelivered,
  saveChatMessage,
} from '../db/database'
import { getDeviceUUID } from '../services/appState'
import { getDisplayName } from '../services/profileService'
import {
  onMessageDelivered,
  sendMessage,
} from '../services/meshService'
import useAppStore from '../store/useAppStore'

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
  const allChatMessages = useAppStore((state) => state.chatMessages)
  const messages = friend?.device_uuid
    ? (allChatMessages[friend.device_uuid] ?? [])
    : []

  const [inputText, setInputText] = useState('')
  const [myDeviceId, setMyDeviceId] = useState<string | null>(null)
  const [myDisplayName, setMyDisplayName] = useState('')

  const flatListRef = useRef<FlatList<ChatMessage>>(null)

  // Load identity and chat history on mount. Re-runs when UUID becomes known (Fix C).
  useEffect(() => {
    if (!friend) return
    getDeviceUUID().then(setMyDeviceId)
    getDisplayName().then(setMyDisplayName)
    const uuid = friend.device_uuid
    if (!uuid) {
      console.warn('[Chat] Friend UUID not known yet — waiting for first message')
      return
    }
    const history = getChatHistory(uuid, 50)
    history.forEach((msg) => {
      useAppStore.getState().addChatMessage(uuid, msg)
    })
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

  const handleSend = useCallback(async () => {
    const body = inputText.trim()
    if (!body || !myDeviceId || !friend) return

    setInputText('')

    // Get or create a persistent thread ID for this friendship.
    const threadKey = `thread_${friend.device_uuid}`
    let threadId = await AsyncStorage.getItem(threadKey)
    if (!threadId) {
      threadId = uuidv4()
      await AsyncStorage.setItem(threadKey, threadId)
    }

    const msgId = uuidv4()
    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    const chatMsg: ChatMessage = {
      id: msgId,
      thread_id: threadId,
      friend_device_uuid: friend.device_uuid,
      body,
      sender_id: myDeviceId,
      is_outgoing: true,
      created_at: now,
      delivered: false,
    }

    saveChatMessage(chatMsg)
    useAppStore.getState().addChatMessage(friend.device_uuid, chatMsg)

    const meshMessage: Message = {
      message_id: msgId,
      body,
      sender_id: myDeviceId,
      sender_name: myDisplayName,
      destination_id: friend.device_uuid,
      chat_thread_id: threadId,
      message_type: 'chat',
      priority_tier: 'LOW',
      priority_score: 0,
      ttl: 10,
      hop_count: 0,
      created_at: nowIso,
      last_hop_at: nowIso,
      synced: false,
      gps_lat: null,
      gps_lng: null,
      location_hint: '',
    }

    try {
      await sendMessage(meshMessage)
    } catch (e) {
      console.error('[ChatScreen] sendMessage failed:', e)
    }
  }, [inputText, myDeviceId, myDisplayName, friend])

  if (!friend) return null

  const isOnline =
    friend.last_seen_at !== null &&
    Date.now() - friend.last_seen_at < 5 * 60 * 1000

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    if (item.is_outgoing) {
      return (
        <View style={styles.rowRight}>
          <View style={styles.bubbleOut}>
            <Text style={styles.bubbleTextOut}>{item.body}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.timeOut}>{formatTime(item.created_at)}</Text>
              <Text
                style={[
                  styles.tick,
                  item.delivered ? styles.tickDelivered : styles.tickPending,
                ]}
              >
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
        <View style={styles.bubbleIn}>
          <Text style={styles.bubbleTextIn}>{item.body}</Text>
          <Text style={styles.timeIn}>{formatTime(item.created_at)}</Text>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView style={styles.root}>
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
          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
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
})

export default ChatScreen
