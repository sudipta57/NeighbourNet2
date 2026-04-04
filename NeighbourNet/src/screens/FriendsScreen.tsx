import React, { useEffect, useState } from 'react'
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
import { Friend } from '../types/message'
import { getFriendByCode, saveFriend } from '../db/database'
import { isValidFriendCode } from '../services/profileService'
import useAppStore from '../store/useAppStore'

interface FriendsScreenProps {
  onOpenChat: (friend: Friend) => void
}

const AVATAR_COLORS = ['#1A237E', '#B71C1C', '#1B5E20', '#4A148C', '#E65100', '#006064']

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getStatusInfo(friend: Friend): { dot: string; label: string } {
  const hasUUID = friend.device_uuid !== '' && friend.device_uuid != null
  if (!hasUUID) {
    return { dot: '#9E9E9E', label: 'Waiting to identify...' }
  }
  const now = Date.now()
  if (friend.last_seen_at !== null) {
    const diff = now - friend.last_seen_at
    if (diff <= 5 * 60 * 1000) {
      const hops = friend.hop_distance ?? 1
      return {
        dot: '#4CAF50',
        label: `Nearby • ${hops} hop${hops !== 1 ? 's' : ''}`,
      }
    }
    if (diff <= 60 * 60 * 1000) {
      const minutes = Math.floor(diff / 60000)
      return { dot: '#FFC107', label: `Last seen ${minutes}m ago` }
    }
  }
  return { dot: '#FFC107', label: 'Identified, not nearby' }
}

const FriendsScreen = ({ onOpenChat }: FriendsScreenProps) => {
  const friends = useAppStore((state) => state.friends)
  const [code, setCode] = useState('')
  const [feedback, setFeedback] = useState<{ msg: string; isError: boolean } | null>(null)

  useEffect(() => {
    useAppStore.getState().loadFriendsFromDB()
  }, [])

  const handleAddFriend = () => {
    const trimmed = code.trim()
    if (!isValidFriendCode(trimmed)) {
      setFeedback({ msg: 'Please enter a valid 4-digit code.', isError: true })
      return
    }
    const existing = getFriendByCode(trimmed)
    if (existing) {
      setFeedback({ msg: 'Already added.', isError: true })
      return
    }
    const friend: Friend = {
      friend_code: trimmed,
      device_uuid: '',
      display_name: `Friend ${trimmed}`,
      last_seen_at: null,
      hop_distance: null,
      added_at: Date.now(),
    }
    saveFriend(friend)
    useAppStore.getState().addFriend(friend)
    setCode('')
    setFeedback({ msg: "Friend added! They'll appear when in range.", isError: false })
  }

  const renderFriend = ({ item }: { item: Friend }) => {
    const { dot, label } = getStatusInfo(item)
    const initial = item.display_name.charAt(0).toUpperCase()
    const avatarColor = getAvatarColor(item.display_name)
    return (
      <TouchableOpacity style={styles.row} onPress={() => onOpenChat(item)} activeOpacity={0.7}>
        <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={styles.rowCenter}>
          <Text style={styles.rowName}>{item.display_name}</Text>
          <Text style={styles.rowCode}>{item.friend_code}</Text>
        </View>
        <View style={styles.rowRight}>
          <View style={[styles.statusDot, { backgroundColor: dot }]} />
          <Text style={styles.statusLabel}>{label}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Text style={styles.screenTitle}>Friends</Text>

        <View style={styles.addSection}>
          <Text style={styles.sectionLabel}>Add Friend</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={(t) => {
              setCode(t)
              setFeedback(null)
            }}
            placeholder="Enter friend's 4-digit code"
            placeholderTextColor="rgba(255,255,255,0.4)"
            keyboardType="numeric"
            maxLength={4}
            returnKeyType="done"
          />
          {feedback !== null ? (
            <Text
              style={[
                styles.feedback,
                feedback.isError ? styles.feedbackError : styles.feedbackSuccess,
              ]}
            >
              {feedback.msg}
            </Text>
          ) : null}
          <TouchableOpacity
            style={[styles.addButton, code.length < 4 && styles.addButtonDisabled]}
            onPress={handleAddFriend}
            disabled={code.length < 4}
            activeOpacity={0.8}
          >
            <Text style={styles.addButtonText}>Add Friend</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.listSection}>
          <Text style={styles.sectionLabel}>Friends</Text>
          <FlatList
            data={friends}
            keyExtractor={(item) => item.friend_code}
            renderItem={renderFriend}
            style={styles.list}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {'No friends added yet.\nShare your code from the Profile tab.'}
              </Text>
            }
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1A237E',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  addSection: {
    marginBottom: 28,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 18,
    color: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.08)',
    letterSpacing: 4,
    marginBottom: 8,
  },
  feedback: {
    fontSize: 13,
    marginBottom: 8,
  },
  feedbackError: {
    color: '#EF9A9A',
  },
  feedbackSuccess: {
    color: '#A5D6A7',
  },
  addButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addButtonDisabled: {
    opacity: 0.35,
  },
  addButtonText: {
    color: '#1A237E',
    fontWeight: '700',
    fontSize: 15,
  },
  listSection: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  rowCenter: {
    flex: 1,
  },
  rowName: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  rowCode: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 2,
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: 4,
  },
  statusLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 32,
    lineHeight: 22,
  },
})

export default FriendsScreen
