import React, { useEffect, useCallback, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import useAppStore from '../store/useAppStore'
import { Message } from '../types/message'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { MeshStackParamList } from '../navigation/AppNavigator'

const formatTwoDigit = (value: number): string => value.toString().padStart(2, '0')

const getTimePart = (date: Date): string => {
  return `${formatTwoDigit(date.getHours())}:${formatTwoDigit(date.getMinutes())}`
}

export const formatRelativeTime = (iso: string | null): string => {
  if (!iso) return 'Unknown'
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return 'Unknown'
    return `${getTimePart(date)} PM` // simplified formatting to match design
  } catch {
    return 'Unknown'
  }
}

interface MessageCardProps {
  message: Message
}

const MessageCard = ({ message }: MessageCardProps) => {
  const isCritical = message.priority_tier === 'CRITICAL'
  const isTrek = message.priority_tier === 'LOW' || message.body.toLowerCase().includes('trek')
  const borderLeftColor = isCritical ? '#D32F2F' : 'transparent'
  
  return (
    <View style={[styles.messageCard, { borderLeftColor, borderLeftWidth: 3 }]}>
      <View style={styles.messageHeaderRow}>
        <View style={styles.messageTypeWrap}>
          {isCritical ? (
            <MaterialCommunityIcons name="asterisk" size={12} color="#D32F2F" />
          ) : (
            <MaterialCommunityIcons name="message-text" size={12} color="#1565C0" />
          )}
          <Text style={[styles.messageTypeLabel, { color: isCritical ? '#D32F2F' : '#1565C0' }]}>
            {isCritical ? 'CRITICAL ALERT' : 'TREK UPDATE'}
          </Text>
        </View>
        <Text style={styles.messageTimeText}>{formatRelativeTime(message.created_at)}</Text>
      </View>

      <Text style={styles.messageTitle} numberOfLines={1}>
        {message.body.split('\n')[0] || 'New Message'}
      </Text>
      <Text style={styles.messageBody} numberOfLines={2}>
        {message.body}
      </Text>

      <View style={styles.messageBottomRow}>
        <View style={styles.hopWrap}>
          <MaterialCommunityIcons name="graphql" size={14} color="#00695C" />
          <Text style={styles.hopText}>{message.hop_count ?? 1} HOP{message.hop_count && message.hop_count > 1 ? 'S' : ''}</Text>
        </View>
        <View style={styles.statusWrap}>
          {message.synced ? (
            <>
              <MaterialCommunityIcons name="check-all" size={14} color="#424242" />
              <Text style={styles.statusText}>DELIVERED</Text>
            </>
          ) : (
            <Text style={styles.syncingText}>SYNCING...</Text>
          )}
        </View>
      </View>
    </View>
  )
}

type MeshStatusScreenProps = NativeStackScreenProps<MeshStackParamList, 'MeshStatus'>

const MeshStatusScreen = ({ navigation }: MeshStatusScreenProps) => {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'unsynced' | 'critical' | 'trek'>('all')

  const isMeshActive = useAppStore((state) => state.isMeshActive)
  const peerCount = useAppStore((state) => state.peerCount)
  const queueDepth = useAppStore((state) => state.queueDepth)
  const messages = useAppStore((state) => state.messages)

  useEffect(() => {
    useAppStore.getState().refreshMessages()
    useAppStore.getState().refreshQueueDepth()
    void useAppStore.getState().triggerPeerScan()
  }, [])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      useAppStore.getState().refreshMessages()
      useAppStore.getState().refreshQueueDepth()
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  const critical = messages.filter((message) => message.priority_tier === 'CRITICAL')
  const allMessages = messages
  const unsyncedMessages = messages.filter((message) => !message.synced)

  const displayedMessages =
    activeTab === 'all' ? allMessages : activeTab === 'unsynced' ? unsyncedMessages : activeTab === 'critical' ? critical : allMessages

  const activePeersFound = peerCount > 0

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F8FE" />

      {/* Global Header */}
      <View style={styles.appHeader}>
        <View style={styles.appHeaderLeft}>
          <MaterialCommunityIcons name="waves" size={24} color="#182A6A" />
          <Text style={styles.appHeaderTitle}>NeighbourNet</Text>
        </View>
        <Ionicons name="radio-outline" size={24} color="#182A6A" />
      </View>

      <ScrollView
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#1A237E"
            colors={['#1A237E']}
          />
        }
      >
        <View style={styles.meshStatusHeader}>
          <Text style={styles.meshActiveLabel}>MESH {isMeshActive ? 'ACTIVE' : 'INACTIVE'}</Text>
          <Text style={styles.networkTitle}>Network Status</Text>
        </View>

        {/* Decorative Map */}
        <View style={styles.mapContainer}>
             <View style={styles.radarOuter}>
                <View style={styles.radarMiddle}>
                   <View style={styles.radarInner}>
                       <View style={styles.radarCenter}>
                          <Ionicons name="person" size={18} color="#FFFFFF" />
                       </View>
                       
                       {/* Rafi Node */}
                       <View style={[styles.node, styles.nodeRafi]}>
                          <View style={styles.dotRafi} />
                          <Text style={styles.nodeTextRafi}>RAFI</Text>
                          <View style={styles.nodeIcon}>
                            <MaterialCommunityIcons name="signal" size={14} color="#182A6A" />
                          </View>
                       </View>
                       
                       {/* Node 4X */}
                       <View style={[styles.node, styles.node4x]}>
                          <View style={styles.dot4x} />
                          <Text style={styles.nodeText4x}>NODE_4X</Text>
                          <View style={styles.nodeIcon}>
                            <MaterialCommunityIcons name="graphql" size={14} color="#4FB99F" />
                          </View>
                       </View>

                       {/* Unknown Node */}
                       <View style={[styles.node, styles.nodeUnknown]}>
                          <View style={styles.dotUnknown} />
                          <Text style={styles.nodeTextUnknown}>UNKNOWN</Text>
                       </View>

                   </View>
                </View>
             </View>
        </View>

        {/* Closest Friend Card */}
        <View style={styles.closestCard}>
           <View style={styles.closestLeft}>
             <View style={styles.closestIconWrap}>
               <MaterialCommunityIcons name="compass-outline" size={20} color="#182A6A" />
             </View>
             <View>
               <Text style={styles.closestLabel}>CLOSEST FRIEND</Text>
               <Text style={styles.closestTitle}>Rafi is ~40m away</Text>
             </View>
           </View>
           <View style={styles.closestRight}>
             <MaterialCommunityIcons name="navigation" size={24} color="#182A6A" style={styles.rotateNav} />
             <Text style={styles.closestHops}>2 HOPS</Text>
           </View>
        </View>

        {/* Message Queue Section */}
        <View style={styles.queueHeaderRow}>
           <Text style={styles.queueTitle}>Message Queue</Text>
           <View style={styles.pendingBadge}>
             <Text style={styles.pendingText}>{queueDepth} PENDING</Text>
           </View>
        </View>

        <View style={styles.filterRow}>
            <TouchableOpacity 
              style={[styles.filterBtn, activeTab === 'all' && styles.filterBtnActive]} 
              onPress={() => setActiveTab('all')}
            >
              <Text style={[styles.filterText, activeTab === 'all' && styles.filterTextActive]}>ALL</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.filterBtn, activeTab === 'unsynced' && styles.filterBtnActive]} 
              onPress={() => setActiveTab('unsynced')}
            >
              <Text style={[styles.filterText, activeTab === 'unsynced' && styles.filterTextActive]}>UNSYNCED</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.filterBtn, styles.filterBtnCritical, activeTab === 'critical' && styles.filterBtnCriticalActive]}
              onPress={() => setActiveTab('critical')}
            >
              <Text style={[styles.filterText, styles.filterTextCritical, activeTab === 'critical' && styles.filterTextCriticalActive]}>CRITICAL</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.filterBtn, activeTab === 'trek' && styles.filterBtnActive]} 
              onPress={() => setActiveTab('trek')}
            >
              <Text style={[styles.filterText, activeTab === 'trek' && styles.filterTextActive]}>TREK</Text>
            </TouchableOpacity>
        </View>

        <View style={styles.messagesContainer}>
           {displayedMessages.slice(0, 5).map(message => (
              <MessageCard key={message.message_id} message={message} />
           ))}
        </View>

        {/* Bottom End indicator */}
        <View style={styles.endIndicator}>
           <MaterialCommunityIcons name="eye-off-outline" size={32} color="#B0BEC5" />
           <Text style={styles.endIndicatorText}>NO OLDER MESSAGES IN QUEUE</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFBFD',
  },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: '#FAFBFD',
  },
  appHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appHeaderTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#182A6A',
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  meshStatusHeader: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  meshActiveLabel: {
    fontSize: 10,
    color: '#4FB99F',
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 4,
  },
  networkTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0D1C4A',
  },
  mapContainer: {
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  radarOuter: {
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 1,
    borderColor: '#F0F3FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarMiddle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#E8EDF9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarInner: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1,
    borderColor: '#DDECFA',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  radarCenter: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#182A6A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  // Map positioning for static mock
  node: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 20,
  },
  nodeIcon: {
    marginTop: 2,
  },
  nodeRafi: {
    top: -50,
    right: -20,
  },
  dotRafi: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#182A6A',
  },
  nodeTextRafi: {
    color: '#182A6A',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 4,
  },
  node4x: {
    bottom: -30,
    left: -10,
  },
  dot4x: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4FB99F',
  },
  nodeText4x: {
    color: '#4FB99F',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 4,
  },
  nodeUnknown: {
    top: 20,
    left: -70,
  },
  dotUnknown: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#BCC5D9',
  },
  nodeTextUnknown: {
    color: '#707F9E',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 4,
  },
  closestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 24,
  },
  closestLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  closestIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EBF0FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closestLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7B88A0',
    letterSpacing: 1,
    marginBottom: 2,
  },
  closestTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#182A6A',
  },
  closestRight: {
    alignItems: 'center',
  },
  rotateNav: {
    transform: [{ rotate: '45deg' }],
    marginBottom: 4,
  },
  closestHops: {
    fontSize: 10,
    fontWeight: '800',
    color: '#182A6A',
  },
  queueHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  queueTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#182A6A',
  },
  pendingBadge: {
    backgroundColor: '#E6ECF9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pendingText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#182A6A',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#F0F3FA',
  },
  filterBtnActive: {
    backgroundColor: '#0D1C4A',
  },
  filterText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4F5C7A',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  filterBtnCritical: {
    backgroundColor: '#FFE9E9',
  },
  filterBtnCriticalActive: {
    backgroundColor: '#D32F2F',
  },
  filterTextCritical: {
    color: '#D32F2F',
  },
  filterTextCriticalActive: {
    color: '#FFFFFF',
  },
  messagesContainer: {
    marginTop: 4,
  },
  messageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  messageHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  messageTypeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  messageTypeLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  messageTimeText: {
    fontSize: 10,
    color: '#A0ADC9',
  },
  messageTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0D1C4A',
    marginBottom: 4,
  },
  messageBody: {
    fontSize: 13,
    color: '#4F5C7A',
    lineHeight: 18,
  },
  messageBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  hopWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hopText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#00695C',
  },
  statusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#424242',
  },
  syncingText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9E9E9E',
  },
  endIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FB',
    borderRadius: 16,
    paddingVertical: 32,
    marginTop: 12,
    marginBottom: 12,
  },
  endIndicatorText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9EABC7',
    marginTop: 8,
    letterSpacing: 1,
  },
})

export default MeshStatusScreen
