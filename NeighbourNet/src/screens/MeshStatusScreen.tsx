import React, { useEffect, useCallback, useState, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Animated,
} from 'react-native'
import * as Location from 'expo-location'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import useAppStore from '../store/useAppStore'
import useMeshStore from '../store/meshStore'
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
  const [showAllMessages, setShowAllMessages] = useState(false)
  const [compassDegree, setCompassDegree] = useState<number | null>(null)

  const isMeshActive = useAppStore((state) => state.isMeshActive)
  const peerCount = useAppStore((state) => state.peerCount)
  const queueDepth = useAppStore((state) => state.queueDepth)
  const messages = useAppStore((state) => state.messages)
  const currentPeers = useMeshStore((state) => state.currentPeers)

  const headingAnim = useRef(new Animated.Value(0)).current
  const cumulativeHeading = useRef(0)
  const lastRawHeading = useRef<number | null>(null)

  const compassRingRotate = headingAnim.interpolate({
    inputRange: [-36000, 36000],
    outputRange: ['-36000deg', '36000deg'],
  })
  const compassCounterRotate = headingAnim.interpolate({
    inputRange: [-36000, 36000],
    outputRange: ['36000deg', '-36000deg'],
  })

  useEffect(() => {
    let headingSub: Location.LocationSubscription | null = null

    const startCompass = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      headingSub = await Location.watchHeadingAsync((hdg) => {
        const raw = hdg.magHeading
        if (lastRawHeading.current === null) {
          // First reading — seed cumulative with the actual absolute heading
          cumulativeHeading.current = raw
        } else {
          let delta = raw - lastRawHeading.current
          if (delta > 180) delta -= 360
          if (delta < -180) delta += 360
          cumulativeHeading.current += delta
        }
        lastRawHeading.current = raw
        setCompassDegree(Math.round(raw))
        Animated.timing(headingAnim, {
          toValue: -cumulativeHeading.current,
          duration: 200,
          useNativeDriver: true,
        }).start()
      })
    }

    void startCompass()
    return () => { headingSub?.remove() }
  }, [headingAnim])

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
  const trekMessages = messages.filter((message) => message.priority_tier === 'LOW' || message.body.toLowerCase().includes('trek'))
  const allMessages = messages
  const unsyncedMessages = messages.filter((message) => !message.synced)

  const displayedMessages =
    activeTab === 'all'
      ? allMessages
      : activeTab === 'unsynced'
      ? unsyncedMessages
      : activeTab === 'critical'
      ? critical
      : activeTab === 'trek'
      ? trekMessages
      : allMessages

  const activePeersFound = peerCount > 0
  const visibleMessages = showAllMessages ? displayedMessages : displayedMessages.slice(0, 5)
  const visualNodes = currentPeers.slice(0, 5)

  const getCardinalLabel = (deg: number): string => {
    const d = ((deg % 360) + 360) % 360
    if (d < 22.5 || d >= 337.5) return 'N'
    if (d < 67.5) return 'NE'
    if (d < 112.5) return 'E'
    if (d < 157.5) return 'SE'
    if (d < 202.5) return 'S'
    if (d < 247.5) return 'SW'
    if (d < 292.5) return 'W'
    return 'NW'
  }

  const VISUAL_NODE_POSITIONS = [
    { top: -50, right: -20 },
    { bottom: -30, left: -10 },
    { top: 20, left: -70 },
    { top: -20, left: 100 },
    { bottom: -10, right: -60 },
  ]

  const VISUAL_NODE_COLORS = [
    '#182A6A', // Dark Blue
    '#4FB99F', // Mint Green
    '#D32F2F', // Red
    '#E65100', // Orange
    '#6A1B9A', // Purple
  ]

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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
          <TouchableOpacity 
            style={[styles.peerBadge, { backgroundColor: peerCount > 0 ? '#E4FCF3' : '#F0F3FA' }]}
            onPress={() => navigation.navigate('SignalMonitor')}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons 
              name={peerCount > 0 ? "account-network" : "account-network-outline"} 
              size={12} 
              color={peerCount > 0 ? '#00695C' : '#7B88A0'} 
            />
            <Text style={[styles.peerText, { color: peerCount > 0 ? '#00695C' : '#7B88A0' }]}>
              {peerCount} {peerCount === 1 ? 'PEER' : 'PEERS'} CONNECTED
            </Text>
          </TouchableOpacity>
        </View>

        {/* Decorative Map */}
        <View style={styles.mapContainer}>
          <View style={styles.radarWrapper}>

            {/* Compass Ring — rotates opposite to device heading so N always points north */}
            <Animated.View
              style={[styles.compassRing, { transform: [{ rotate: compassRingRotate }] }]}
              pointerEvents="none"
            >
              {/* N */}
              <Animated.View style={[styles.compassLabelN, { transform: [{ rotate: compassCounterRotate }] }]}>
                <View style={styles.compassTickN} />
                <Text style={styles.compassLabelNText}>N</Text>
              </Animated.View>
              {/* E */}
              <Animated.View style={[styles.compassLabelE, { transform: [{ rotate: compassCounterRotate }] }]}>
                <Text style={styles.compassLabelText}>E</Text>
                <View style={styles.compassTickE} />
              </Animated.View>
              {/* S */}
              <Animated.View style={[styles.compassLabelS, { transform: [{ rotate: compassCounterRotate }] }]}>
                <Text style={styles.compassLabelText}>S</Text>
                <View style={styles.compassTickS} />
              </Animated.View>
              {/* W */}
              <Animated.View style={[styles.compassLabelW, { transform: [{ rotate: compassCounterRotate }] }]}>
                <View style={styles.compassTickW} />
                <Text style={styles.compassLabelText}>W</Text>
              </Animated.View>
            </Animated.View>

            <View style={styles.radarOuter}>
              <View style={styles.radarMiddle}>
                <View style={styles.radarInner}>
                  <View style={styles.radarCenter}>
                    <Ionicons name="person" size={18} color="#FFFFFF" />
                  </View>

                  {/* Dynamic Connected Nodes */}
                  {visualNodes.map((peer, index) => {
                    const pos = VISUAL_NODE_POSITIONS[index]
                    const color = VISUAL_NODE_COLORS[index]
                    const peerId = peer.id || (peer as any).endpointId || `node-${index}`
                    const peerName = peerId.slice(-6).toUpperCase()
                    const rssiText = peer.rssi ? `${Math.max(-100, Math.min(-40, peer.rssi))}dB` : 'MESH'

                    return (
                      <View key={peerId} style={[styles.node, pos]}>
                        <View style={[styles.dynamicDot, { backgroundColor: color }]} />
                        <Text style={[styles.dynamicNodeText, { color }]}>{peerName}</Text>
                        <Text style={[styles.dynamicNodeRssi, { color }]}>{rssiText}</Text>
                        <View style={styles.nodeIcon}>
                          <MaterialCommunityIcons name="signal" size={12} color={color} />
                        </View>
                      </View>
                    )
                  })}
                </View>
              </View>
            </View>

          </View>

          {/* Heading degree display */}
          <View style={styles.headingBadge}>
            {compassDegree !== null ? (
              <>
                <Text style={styles.headingCardinal}>{getCardinalLabel(compassDegree)}</Text>
                <Text style={styles.headingDegree}>{compassDegree}°</Text>
              </>
            ) : (
              <Text style={styles.headingDegreeOff}>— °</Text>
            )}
          </View>
        </View>

        {/* Connected Peers Cards */}
        {currentPeers.length > 0 ? (
          currentPeers.map((peer, index) => {
            const peerId = peer.id || (peer as any).endpointId || `node-${index}`
            return (
              <View key={peerId} style={styles.closestCard}>
                 <View style={styles.closestLeft}>
                   <View style={styles.closestIconWrap}>
                     <MaterialCommunityIcons name="access-point-network" size={20} color="#182A6A" />
                   </View>
                   <View>
                     <Text style={styles.closestLabel}>CONNECTED NODE</Text>
                     <Text style={styles.closestTitle}>Node {peerId.slice(-6).toUpperCase()} Active</Text>
                   </View>
                 </View>
                 <View style={styles.closestRight}>
                   <MaterialCommunityIcons name="signal" size={24} color="#4FB99F" />
                   <Text style={[styles.closestHops, { color: '#4FB99F' }]}>
                     {peer.rssi ? `${Math.max(-100, Math.min(-40, peer.rssi))} dBm` : 'MESH'}
                   </Text>
                 </View>
              </View>
            )
          })
        ) : (
          <View style={styles.closestCard}>
             <View style={styles.closestLeft}>
               <View style={styles.closestIconWrap}>
                 <MaterialCommunityIcons name="access-point-network-off" size={20} color="#A0ADC9" />
               </View>
               <View>
                 <Text style={styles.closestLabel}>MESH NETWORK</Text>
                 <Text style={[styles.closestTitle, { color: '#7B88A0' }]}>No active nodes nearby</Text>
               </View>
             </View>
          </View>
        )}

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
              onPress={() => {
                setActiveTab('all')
                setShowAllMessages(false)
              }}
            >
              <Text style={[styles.filterText, activeTab === 'all' && styles.filterTextActive]}>ALL</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.filterBtn, activeTab === 'unsynced' && styles.filterBtnActive]} 
              onPress={() => {
                setActiveTab('unsynced')
                setShowAllMessages(false)
              }}
            >
              <Text style={[styles.filterText, activeTab === 'unsynced' && styles.filterTextActive]}>UNSYNCED</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.filterBtn, styles.filterBtnCritical, activeTab === 'critical' && styles.filterBtnCriticalActive]}
              onPress={() => {
                setActiveTab('critical')
                setShowAllMessages(false)
              }}
            >
              <Text style={[styles.filterText, styles.filterTextCritical, activeTab === 'critical' && styles.filterTextCriticalActive]}>CRITICAL</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.filterBtn, activeTab === 'trek' && styles.filterBtnActive]} 
              onPress={() => {
                setActiveTab('trek')
                setShowAllMessages(false)
              }}
            >
              <Text style={[styles.filterText, activeTab === 'trek' && styles.filterTextActive]}>TREK</Text>
            </TouchableOpacity>
        </View>

        <View style={styles.messagesContainer}>
           {visibleMessages.map(message => (
              <MessageCard key={message.message_id} message={message} />
           ))}
        </View>

        {!showAllMessages && displayedMessages.length > 5 && (
          <TouchableOpacity 
            style={styles.seeMoreButton} 
            onPress={() => setShowAllMessages(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.seeMoreText}>SEE ALL MESSAGES ({displayedMessages.length})</Text>
            <MaterialCommunityIcons name="chevron-down" size={16} color="#182A6A" />
          </TouchableOpacity>
        )}

        {/* Bottom End indicator */}
        {(showAllMessages || displayedMessages.length <= 5) && (
          <View style={styles.endIndicator}>
             <MaterialCommunityIcons name="eye-off-outline" size={32} color="#B0BEC5" />
             <Text style={styles.endIndicatorText}>NO OLDER MESSAGES IN QUEUE</Text>
          </View>
        )}

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
  peerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  peerText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  mapContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  radarWrapper: {
    width: 310,
    height: 310,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compassRing: {
    position: 'absolute',
    width: 310,
    height: 310,
    top: 0,
    left: 0,
  },
  compassLabelN: {
    position: 'absolute',
    top: 2,
    left: 145,
    width: 20,
    alignItems: 'center',
  },
  compassLabelE: {
    position: 'absolute',
    top: 145,
    right: 2,
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  compassLabelS: {
    position: 'absolute',
    bottom: 2,
    left: 145,
    width: 20,
    alignItems: 'center',
  },
  compassLabelW: {
    position: 'absolute',
    top: 145,
    left: 2,
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  compassTickN: {
    width: 2,
    height: 6,
    backgroundColor: '#D32F2F',
    borderRadius: 1,
    marginBottom: 2,
  },
  compassTickE: {
    width: 6,
    height: 2,
    backgroundColor: '#7B88A0',
    borderRadius: 1,
    marginLeft: 2,
  },
  compassTickS: {
    width: 2,
    height: 6,
    backgroundColor: '#7B88A0',
    borderRadius: 1,
    marginTop: 2,
  },
  compassTickW: {
    width: 6,
    height: 2,
    backgroundColor: '#7B88A0',
    borderRadius: 1,
    marginRight: 2,
  },
  compassLabelNText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#D32F2F',
    letterSpacing: 0.5,
  },
  compassLabelText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#4F5C7A',
    letterSpacing: 0.5,
  },
  headingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 5,
    backgroundColor: '#F0F3FA',
    borderRadius: 20,
  },
  headingCardinal: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7B88A0',
    letterSpacing: 1,
  },
  headingDegree: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0D1C4A',
    letterSpacing: 0.5,
  },
  headingDegreeOff: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B0BEC5',
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
  dynamicDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dynamicNodeText: {
    fontSize: 9,
    fontWeight: '800',
    marginTop: 4,
  },
  dynamicNodeRssi: {
    fontSize: 8,
    fontWeight: '700',
    opacity: 0.8,
    marginTop: 1,
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
  seeMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FB',
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 4,
    marginBottom: 12,
    gap: 6,
  },
  seeMoreText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#182A6A',
    letterSpacing: 1,
  },
  endIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FB',
    borderRadius: 16,
    paddingVertical: 32,
    marginTop: 4,
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
