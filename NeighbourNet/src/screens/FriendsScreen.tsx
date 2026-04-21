import React, { useEffect, useState } from 'react'
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { Friend } from '../types/message'
import { getFriendByCode, saveFriend } from '../db/database'
import { isValidFriendCode } from '../services/profileService'
import useAppStore from '../store/useAppStore'

interface FriendsScreenProps {
  onOpenChat: (friend: Friend) => void
  onOpenMap: () => void
}

const AVATAR_COLORS = ['#1A237E', '#B71C1C', '#1B5E20', '#4A148C', '#E65100', '#006064']

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getStatusInfo(friend: Friend): { dot: string; label: string; isNearby: boolean } {
  const hasUUID = friend.device_uuid !== '' && friend.device_uuid != null
  if (!hasUUID) {
    return { dot: '#B0BEC5', label: 'Waiting to identify...', isNearby: false }
  }
  const now = Date.now()
  if (friend.last_seen_at !== null) {
    const diff = now - friend.last_seen_at
    if (diff <= 5 * 60 * 1000) {
      const hops = friend.hop_distance ?? 1
      return {
        dot: '#1FD8A4', // green
        label: `${hops * 100}m away • Active now`,
        isNearby: true,
      }
    }
    if (diff <= 60 * 60 * 1000) {
      const minutes = Math.floor(diff / 60000)
      return { dot: '#B0BEC5', label: `Last seen ${minutes}m ago`, isNearby: false }
    }
  }
  return { dot: '#B0BEC5', label: 'Offline / Far away', isNearby: false }
}

const FriendsScreen = ({ onOpenChat, onOpenMap }: FriendsScreenProps) => {
  const friends = useAppStore((state) => state.friends)
  const [code, setCode] = useState('')
  const [feedback, setFeedback] = useState<{ msg: string; isError: boolean } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'1:1' | 'Rooms'>('1:1')

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

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id)
  }

  const nearbyCount = friends.filter(f => getStatusInfo(f).isNearby).length

  const renderFriend = ({ item }: { item: Friend }) => {
    const { dot, label } = getStatusInfo(item)
    const initial = item.display_name.charAt(0).toUpperCase()
    const avatarColor = getAvatarColor(item.display_name)
    const isExpanded = expandedId === item.friend_code

    return (
      <View style={styles.friendCard}>
        <View style={styles.friendTopRow}>
          <TouchableOpacity 
            style={styles.friendTopClickable} 
            onPress={() => onOpenChat(item)} 
            activeOpacity={0.7}
          >
            <View style={[styles.avatarWrap, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarText}>{initial}</Text>
              <View style={[styles.avatarDot, { backgroundColor: dot }]} />
            </View>
            <View style={styles.friendInfo}>
              <Text style={styles.friendName}>{item.display_name}</Text>
              <Text style={styles.friendStatus}>{label}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.chevronBtn} 
            onPress={() => toggleExpand(item.friend_code)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons 
              name={isExpanded ? "chevron-down" : "chevron-right"} 
              size={24} 
              color="#B0BEC5" 
            />
          </TouchableOpacity>
        </View>

        {isExpanded && (
          <View style={styles.expandedActions}>
            <TouchableOpacity style={styles.actionBtnDark} onPress={onOpenMap}>
              <MaterialCommunityIcons name="navigation" size={18} color="#FFFFFF" style={{ transform: [{ rotate: '45deg' }] }} />
              <Text style={styles.actionBtnDarkText}>View on Map</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.actionBtnLight} onPress={() => onOpenChat(item)}>
              <MaterialCommunityIcons name="microphone" size={18} color="#2855F4" />
              <Text style={styles.actionBtnLightText}>Voice Note</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    )
  }

  const ListHeader = () => (
    <>
      {/* Top Toggle */}
      <View style={styles.topToggleWrap}>
        <View style={styles.topToggleRow}>
          <TouchableOpacity 
            style={[styles.toggleBtn, activeTab === '1:1' && styles.toggleBtnActive]}
            onPress={() => setActiveTab('1:1')}
            activeOpacity={0.8}
          >
            <Text style={[styles.toggleBtnText, activeTab === '1:1' && styles.toggleBtnTextActive]}>1:1</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.toggleBtn, activeTab === 'Rooms' && styles.toggleBtnActive]}
            onPress={() => setActiveTab('Rooms')}
            activeOpacity={0.8}
          >
            <Text style={[styles.toggleBtnText, activeTab === 'Rooms' && styles.toggleBtnTextActive]}>Rooms</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Add Friend Input section - added per user request */}
      <View style={styles.addFriendRow}>
        <TextInput
          style={styles.addFriendInput}
          value={code}
          onChangeText={(t) => {
            setCode(t)
            setFeedback(null)
          }}
          placeholder="Add friend ID (e.g. 1234)"
          placeholderTextColor="#90A4AE"
          keyboardType="numeric"
          maxLength={4}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.addFriendBtn, code.length < 4 && styles.addFriendBtnDisabled]}
          onPress={handleAddFriend}
          disabled={code.length < 4}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="plus" size={24} color="#FFF" />
        </TouchableOpacity>
      </View>
      {feedback && (
        <Text style={[styles.feedback, feedback.isError ? styles.feedbackError : styles.feedbackSuccess]}>
          {feedback.msg}
        </Text>
      )}

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>ACTIVE FRIENDS</Text>
        <View style={styles.nearbyBadge}>
           <View style={styles.greenDot} />
           <Text style={styles.nearbyText}>{nearbyCount} NEARBY</Text>
        </View>
      </View>
    </>
  )

  const ListFooter = () => (
    <>
      <View style={[styles.sectionHeaderRow, { marginTop: 32 }]}>
        <Text style={styles.sectionTitle}>ACTIVE ROOMS</Text>
        <TouchableOpacity style={styles.createBtn}>
          <Text style={styles.createBtnText}>+ Create Room</Text>
        </TouchableOpacity>
      </View>

      {/* Block B Resilient Room Mock */}
      <View style={styles.roomCard}>
        <View style={styles.roomTop}>
          <Text style={styles.roomTitle}>Block B Resilient</Text>
          <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>LIVE</Text></View>
        </View>
        <View style={styles.roomSubtitleWrap}>
          <MaterialCommunityIcons name="graphql" size={14} color="#0D1C4A" />
          <Text style={styles.roomSubtitle}>MESH SECURE</Text>
        </View>
        
        <View style={styles.roomBottom}>
          <View style={styles.avatarStack}>
             <View style={[styles.stackAvatar, { backgroundColor: '#4FB99F', zIndex: 3 }]}/>
             <View style={[styles.stackAvatar, { backgroundColor: '#182A6A', zIndex: 2 }]}/>
             <View style={[styles.stackAvatar, { backgroundColor: '#FF8A65', zIndex: 1 }]}/>
             <View style={[styles.stackAvatarNum, { zIndex: 0 }]}>
               <Text style={styles.stackAvatarNumText}>+12</Text>
             </View>
          </View>
          <TouchableOpacity style={styles.joinRoomBtn}>
            <MaterialCommunityIcons name="chevron-right" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Emergency Prep Hub Mock */}
      <View style={styles.emptyRoomCard}>
        <View style={styles.emptyRoomIconWrap}>
          <MaterialCommunityIcons name="door-sliding" size={24} color="#0D1C4A" />
        </View>
        <Text style={styles.emptyRoomTitle}>Emergency Prep Hub</Text>
        <Text style={styles.emptyRoomDesc}>Create an encrypted room to coordinate with immediate neighbors.</Text>
      </View>
    </>
  )

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Global Header */}
      <View style={styles.appHeader}>
        <View style={styles.headerLeftWrap}>
          <MaterialCommunityIcons name="waves" size={24} color="#182A6A" />
          <Text style={styles.appHeaderTitle}>NeighbourNet</Text>
        </View>
        <Ionicons name="radio-outline" size={24} color="#182A6A" />
      </View>

      <KeyboardAvoidingView style={styles.inner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={friends}
          keyExtractor={(item) => item.friend_code}
          renderItem={renderFriend}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={ListFooter}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No friends added yet.</Text>
          }
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FAFBFD',
  },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerLeftWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appHeaderTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#182A6A',
  },
  inner: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  topToggleWrap: {
    alignItems: 'center',
    marginBottom: 20,
  },
  topToggleRow: {
    flexDirection: 'row',
    backgroundColor: '#EEF2FC',
    borderRadius: 16,
    padding: 6,
    width: '100%',
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 12,
  },
  toggleBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  toggleBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7B88A0',
  },
  toggleBtnTextActive: {
    color: '#182A6A',
  },
  addFriendRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  addFriendInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#182A6A',
    fontWeight: '600',
    borderWidth: 1,
    borderColor: '#E8EDF9',
  },
  addFriendBtn: {
    width: 48,
    height: 48,
    backgroundColor: '#182A6A',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFriendBtnDisabled: {
    opacity: 0.5,
  },
  feedback: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 16,
    marginTop: -4,
    paddingHorizontal: 4,
  },
  feedbackError: {
    color: '#D32F2F',
  },
  feedbackSuccess: {
    color: '#1FD8A4',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4F5C7A',
    letterSpacing: 1.2,
  },
  nearbyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#A7F3D0', // light mint green
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#047857',
  },
  nearbyText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#047857',
  },
  friendCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  friendTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  friendTopClickable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chevronBtn: {
    padding: 8,
    marginRight: -8,
  },
  avatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    position: 'relative',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  avatarDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  friendInfo: {
    flex: 1,
  },
  friendName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0D1C4A',
    marginBottom: 2,
  },
  friendStatus: {
    fontSize: 12,
    color: '#7B88A0',
  },
  expandedActions: {
    flexDirection: 'row',
    paddingTop: 16,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F0F3FA',
    gap: 12,
  },
  actionBtnDark: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0D1C4A',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  actionBtnDarkText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  actionBtnLight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E6ECF9',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  actionBtnLightText: {
    color: '#2855F4',
    fontSize: 13,
    fontWeight: '700',
  },
  createBtn: {
    backgroundColor: '#E6ECF9',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 14,
  },
  createBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2855F4',
  },
  roomCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  roomTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roomTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0D1C4A',
  },
  liveBadge: {
    backgroundColor: '#E6ECF9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  liveBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#2855F4',
    letterSpacing: 1,
  },
  roomSubtitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  roomSubtitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0D1C4A',
    letterSpacing: 1,
  },
  roomBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 20,
  },
  avatarStack: {
    flexDirection: 'row',
    marginLeft: 0,
  },
  stackAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginLeft: -10,
  },
  stackAvatarNum: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E6ECF9',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginLeft: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackAvatarNumText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4F5C7A',
  },
  joinRoomBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0D47A1', // vibrant blue
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0D47A1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  emptyRoomCard: {
    borderWidth: 2,
    borderColor: '#E8EDF9',
    borderStyle: 'dashed',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    backgroundColor: '#F7F9FC',
    marginBottom: 40,
  },
  emptyRoomIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  emptyRoomTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0D1C4A',
    marginBottom: 8,
  },
  emptyRoomDesc: {
    fontSize: 12,
    color: '#4F5C7A',
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyText: {
    color: '#7B88A0',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 22,
  },
})

export default FriendsScreen
