import React, { useEffect, useRef, useState } from 'react'
import {
  Animated,
  DeviceEventEmitter,
  Easing,
  FlatList,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { MeshStackParamList } from '../navigation/AppNavigator'
import useMeshStore from '../store/meshStore'

export interface Peer {
  endpointId: string
  displayName: string
  rssi: number
}

type PeerConnectEvent = {
  endpointId?: string
  peerCount?: number
}

type MeshPeerLike = {
  id: string
  rssi?: number
}

type Props = NativeStackScreenProps<MeshStackParamList, 'SignalMonitor'>

type SignalStatus = {
  label: string
  color: string
}

const BAR_HEIGHTS = [8, 12, 16, 20]

function clampRssi(rssi: number): number {
  return Math.max(-100, Math.min(-40, rssi))
}

function randomOffset(): number {
  return Math.floor(Math.random() * 7) - 3
}

function getSignalStatus(rssi: number): SignalStatus {
  if (rssi >= -60) {
    return { label: 'Strong / শক্তিশালী', color: '#00c896' }
  }

  if (rssi >= -75) {
    return { label: 'Good / ভালো', color: '#f5c542' }
  }

  return { label: 'Weak / দুর্বল', color: '#ef5350' }
}

function getFilledBars(rssi: number): number {
  if (rssi >= -55) return 4
  if (rssi >= -65) return 3
  if (rssi >= -75) return 2
  return 1
}

function normalizePeers(payload: unknown): Peer[] {
  const incomingPeers = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { peers?: unknown[] }).peers)
      ? (payload as { peers: unknown[] }).peers
      : []

  return incomingPeers.map((peer, index) => {
    const candidate = peer as Partial<Peer> & { id?: string }
    const endpointId = typeof candidate.endpointId === 'string' && candidate.endpointId.trim().length > 0
      ? candidate.endpointId
      : typeof candidate.id === 'string' && candidate.id.trim().length > 0
        ? candidate.id
        : `peer-${index}`

    const displayName = typeof candidate.displayName === 'string' && candidate.displayName.trim().length > 0
      ? candidate.displayName
      : 'Nearby device'

    const rssi = typeof candidate.rssi === 'number'
      ? clampRssi(candidate.rssi)
      : -65

    // TODO: Remove the fallback once the native NearbyModule always emits RSSI for peers.
    return { endpointId, displayName, rssi }
  })
}

function buildPeerFromEndpoint(endpointId: string): Peer {
  const shortId = endpointId.slice(-6)

  return {
    endpointId,
    displayName: `Nearby peer ${shortId}`,
    rssi: -65,
  }
}

function mapMeshPeerToSignalPeer(peer: MeshPeerLike): Peer {
  return {
    endpointId: peer.id,
    displayName: `Nearby peer ${peer.id.slice(-6)}`,
    rssi: typeof peer.rssi === 'number' ? clampRssi(peer.rssi) : -65,
  }
}

const PeerSignalCard = ({ peer }: { peer: Peer }) => {
  const signalStatus = getSignalStatus(peer.rssi)
  const filledBars = getFilledBars(peer.rssi)
  const hintText = peer.rssi < -75 ? 'Move closer / কাছে আসুন' : 'Good connection / ভালো সংযোগ'

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.deviceName} numberOfLines={1}>
          {peer.displayName}
        </Text>
        <Text style={[styles.signalLabel, { color: signalStatus.color }]} numberOfLines={1}>
          {signalStatus.label}
        </Text>
      </View>

      <View style={styles.signalRow}>
        <View style={styles.barsWrap}>
          {BAR_HEIGHTS.map((height, index) => {
            const filled = index < filledBars
            return (
              <View
                key={`${peer.endpointId}-bar-${height}`}
                style={[
                  styles.signalBar,
                  {
                    height,
                    backgroundColor: filled ? '#00c896' : '#2e3d5c',
                  },
                ]}
              />
            )
          })}
        </View>
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.hintText}>{hintText}</Text>
        <Text style={styles.rssiText}>{peer.rssi} dBm</Text>
      </View>
    </View>
  )
}

const SignalMonitorScreen = ({ navigation }: Props) => {
  const [peers, setPeers] = useState<Peer[]>([])
  const pulse = useRef(new Animated.Value(1)).current
  const currentMeshPeers = useMeshStore((state) => state.currentPeers)

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    )

    animation.start()

    return () => {
      animation.stop()
    }
  }, [pulse])

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('onPeersUpdated', (payload) => {
      setPeers(normalizePeers(payload))
    })

    const connectedSubscription = DeviceEventEmitter.addListener('onPeerConnected', (payload: PeerConnectEvent) => {
      if (!payload?.endpointId) {
        return
      }

      setPeers((currentPeers) => {
        if (currentPeers.some((peer) => peer.endpointId === payload.endpointId)) {
          return currentPeers
        }

        return [...currentPeers, buildPeerFromEndpoint(payload.endpointId)]
      })
    })

    const disconnectedSubscription = DeviceEventEmitter.addListener('onPeerDisconnected', (payload: PeerConnectEvent) => {
      if (!payload?.endpointId) {
        return
      }

      setPeers((currentPeers) => currentPeers.filter((peer) => peer.endpointId !== payload.endpointId))
    })

    return () => {
      subscription.remove()
      connectedSubscription.remove()
      disconnectedSubscription.remove()
    }
  }, [])

  useEffect(() => {
    if (currentMeshPeers.length === 0) {
      return
    }

    setPeers(currentMeshPeers.map(mapMeshPeerToSignalPeer))
  }, [currentMeshPeers])

  useEffect(() => {
    if (!__DEV__) {
      return
    }

    const timer = setInterval(() => {
      setPeers((currentPeers) =>
        currentPeers.map((peer) => ({
          ...peer,
          rssi: clampRssi(peer.rssi + randomOffset()),
        }))
      )
    }, 2000)

    return () => {
      clearInterval(timer)
    }
  }, [])

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a2340" />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerContent}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              Signal Monitor / সংকেত মনিটর
            </Text>
            <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
          </View>
          <Text style={styles.subtitle}>Live mesh peer signal strength</Text>
        </View>
      </View>

      <FlatList
        data={peers}
        keyExtractor={(item) => item.endpointId}
        renderItem={({ item }) => <PeerSignalCard peer={item} />}
        contentContainerStyle={[styles.listContent, peers.length === 0 && styles.emptyListContent]}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📴</Text>
            <Text style={styles.emptyTitle}>No peers nearby / কোনো পিয়ার নেই</Text>
            <Text style={styles.emptySubtitle}>Move to an open area to find mesh nodes</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a2340',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#252f4a',
    marginTop: 2,
  },
  backIcon: {
    color: '#ffffff',
    fontSize: 28,
    lineHeight: 28,
    marginTop: -2,
  },
  headerContent: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00c896',
  },
  subtitle: {
    marginTop: 4,
    color: '#8899aa',
    fontSize: 13,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 12,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    marginTop: 8,
    color: '#8899aa',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#252f4a',
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  deviceName: {
    flex: 1,
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  signalLabel: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  signalRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  barsWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    height: 24,
  },
  signalBar: {
    width: 7,
    borderRadius: 4,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 12,
  },
  hintText: {
    flex: 1,
    color: '#8899aa',
    fontSize: 12,
    lineHeight: 16,
  },
  rssiText: {
    color: '#8899aa',
    fontSize: 11,
    fontWeight: '600',
  },
})

export default SignalMonitorScreen
