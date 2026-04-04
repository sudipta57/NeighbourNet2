import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import NetInfo from '@react-native-community/netinfo'
import OnboardingScreen from './src/screens/OnboardingScreen'
import SosScreen from './src/screens/SosScreen'
import MeshStatusScreen from './src/screens/MeshStatusScreen'
import FriendsScreen from './src/screens/FriendsScreen'
import ProfileScreen from './src/screens/ProfileScreen'
import ChatScreen from './src/screens/ChatScreen'
import TabBar from './src/components/TabBar'
import { isOnboardingComplete, markOnboardingComplete, getDeviceUUID } from './src/services/appState'
import { startGatewaySync, stopGatewaySync } from './src/services/gatewaySync'
import { onMessageReceived, onPeerConnected, onPeerDisconnected, startMesh, stopMesh } from './src/services/meshService'
import { initDatabase, saveChatMessage, updateFriendLastSeen, getFriendByUUID, getFriendByCode, getFriends, saveFriend } from './src/db/database'
import { flushPendingMeshForwards } from './src/services/meshRelay'
import useAppStore from './src/store/useAppStore'
import useMeshStore from './src/store/meshStore'
import { startTelemetryReporter, stopTelemetryReporter } from './src/mesh/telemetryReporter'
import { Friend, ChatMessage } from './src/types/message'
import { generateFriendCode } from './src/services/profileService'
import { startBeacon, stopBeacon } from './src/services/beaconService'

const PEER_REFRESH_INTERVAL_MS = 15000

type TabName = 'sos' | 'mesh' | 'friends' | 'profile' | 'chat'

const App = () => {
  const [appReady, setAppReady] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [activeTab, setActiveTab] = useState<TabName>('sos')
  const [initError, setInitError] = useState<string | null>(null)

  const messages = useAppStore((state) => state.messages)

  const criticalCount = messages.filter((message) => message.priority_tier === 'CRITICAL').length

  const requestMeshPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true

    try {
      const apiLevel = Number(Platform.Version)

      if (apiLevel >= 31) {
        const requiredPermissions = [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]

        const requiredResults = await PermissionsAndroid.requestMultiple(requiredPermissions)

        const requiredGranted = Object.values(requiredResults).every(
          (result) => result === PermissionsAndroid.RESULTS.GRANTED
        )

        if (!requiredGranted) {
          console.warn('[Permissions] Required mesh permissions denied:', requiredResults)
          return false
        }

        // Optional for Nearby Connections in this app, but useful for certain transports on newer Android.
        if (apiLevel >= 33) {
          const optionalResults = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES,
          ])

          if (optionalResults[PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES] !== PermissionsAndroid.RESULTS.GRANTED) {
            console.warn('[Permissions] Optional NEARBY_WIFI_DEVICES denied:', optionalResults)
          }
        }

        return true
      } else {
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ])

        return Object.values(results).every(
          (result) => result === PermissionsAndroid.RESULTS.GRANTED
        )
      }
    } catch (e) {
      console.error('[Permissions] Request failed:', e)
      return false
    }
  }

  useEffect(() => {
    const initializeApp = async () => {
      let firstError: string | null = null

      const runStep = async (step: () => Promise<void> | void) => {
        try {
          await step()
        } catch (error) {
          if (!firstError) {
            firstError = error instanceof Error ? error.message : 'Failed to initialize app'
          }
        }
      }

      await runStep(() => {
        initDatabase()
      })

      await runStep(async () => {
        const completed = await isOnboardingComplete()
        if (!completed) {
          setShowOnboarding(true)
        }
      })

      await runStep(() => {
        useAppStore.getState().refreshMessages()
      })

      await runStep(() => {
        useAppStore.getState().refreshQueueDepth()
      })

      if (firstError) {
        setInitError(firstError)
      }

      setAppReady(true)
    }

    initializeApp()
  }, [])

  useEffect(() => {
    let unsubMessage: (() => void) | null = null
    let unsubConnected: (() => void) | null = null
    let unsubDisconnected: (() => void) | null = null
    let netInfoUnsubscribe: (() => void) | null = null
    let peerRefreshTimer: ReturnType<typeof setInterval> | null = null
    let isFlushingPendingMeshForwards = false

    const init = async () => {
      try {
        const flushPendingMeshQueue = async (): Promise<void> => {
          if (isFlushingPendingMeshForwards) {
            return
          }

          if (useAppStore.getState().peerCount <= 0) {
            return
          }

          isFlushingPendingMeshForwards = true

          try {
            const result = await flushPendingMeshForwards()
            if (result.attempted > 0) {
              console.log(
                `[MeshRelay] Pending forwarded ${result.forwarded}/${result.attempted} message(s)`
              )
            }
          } finally {
            isFlushingPendingMeshForwards = false
          }
        }

        startGatewaySync()

        netInfoUnsubscribe = NetInfo.addEventListener((state) => {
          const online = state.isConnected !== false && state.isInternetReachable !== false
          useAppStore.getState().setOnline(online)
        })

        const initialState = await NetInfo.fetch()
        useAppStore
          .getState()
          .setOnline(initialState.isConnected !== false && initialState.isInternetReachable !== false)

        const permissionsGranted = await requestMeshPermissions()
        console.log('[Permissions] Mesh permissions granted:', permissionsGranted)

        if (!permissionsGranted) {
          useAppStore.getState().setMeshActive(false)
          return
        }

        await startMesh()
        await startBeacon()
        useAppStore.getState().setMeshActive(true)
        const initialPeerCount = await useAppStore.getState().triggerPeerScan()
        if (initialPeerCount > 0) {
          void flushPendingMeshQueue()
        }

        peerRefreshTimer = setInterval(() => {
          void (async () => {
            const peerCount = await useAppStore.getState().refreshPeerCount()
            if (peerCount > 0) {
              await flushPendingMeshQueue()
            }
          })()
        }, PEER_REFRESH_INTERVAL_MS)

        unsubMessage = onMessageReceived(async (incomingMeshMessage) => {
          // Handle identity beacon — link friend code to real UUID
          if (incomingMeshMessage.message_type === 'location_beacon') {
            const senderUUID = incomingMeshMessage.sender_id
            const senderName = incomingMeshMessage.sender_name ?? ''

            // Extract friend code from location_hint first, then fall back to body
            let senderCode = incomingMeshMessage.location_hint?.trim() ?? ''
            if (!senderCode && incomingMeshMessage.body?.startsWith('BEACON:')) {
              senderCode = incomingMeshMessage.body.replace('BEACON:', '').trim()
            }

            console.log('[Beacon] Received from UUID:', senderUUID, 'code:', senderCode)

            if (!senderCode || !senderUUID) return

            // Normalize to 4 digits with leading zeros (e.g. "509" → "0509")
            const normalizedCode = senderCode.padStart(4, '0')

            // Try finding friend — padded first, then raw, then by UUID
            const existingFriend =
              getFriendByCode(normalizedCode) ??
              getFriendByCode(senderCode) ??
              getFriendByUUID(senderUUID)

            if (existingFriend) {
              if (existingFriend.device_uuid !== senderUUID) {
                const updatedFriend = {
                  ...existingFriend,
                  device_uuid: senderUUID,
                  display_name: senderName || existingFriend.display_name,
                  last_seen_at: Date.now(),
                  hop_distance: incomingMeshMessage.hop_count ?? 1,
                }
                saveFriend(updatedFriend)
                useAppStore.getState().addFriend(updatedFriend)
                console.log('[Beacon] ✅ Linked friend', normalizedCode, '→', senderUUID)
              } else {
                updateFriendLastSeen(senderUUID, Date.now(), incomingMeshMessage.hop_count ?? 1)
              }
            } else {
              console.log('[Beacon] ⚠️ No friend found for code:', normalizedCode)
              console.log('[Beacon] Saved friend codes:', getFriends().map(f => f.friend_code))
            }
            return
          }

          // Handle SOS messages (and legacy messages with no type)
          if (!incomingMeshMessage.message_type || incomingMeshMessage.message_type === 'sos') {
            useAppStore.getState().addMessage(incomingMeshMessage)
            return
          }

          // Handle incoming CHAT messages
          if (incomingMeshMessage.message_type === 'chat') {
            const myUUID = await getDeviceUUID()

            // Accept if addressed to me directly, or broadcast (no destination_id)
            const isDirectToMe = incomingMeshMessage.destination_id === myUUID
            const isBroadcast = !incomingMeshMessage.destination_id
            if (!isDirectToMe && !isBroadcast) return

            const senderUUID = incomingMeshMessage.sender_id
            const senderCode = incomingMeshMessage.location_hint?.trim() ?? ''

            // Auto-link sender's UUID to their friend code if we have them saved
            if (senderCode) {
              const normalizedCode = senderCode.padStart(4, '0')
              const friendByCode =
                getFriendByCode(normalizedCode) ?? getFriendByCode(senderCode)
              if (friendByCode && friendByCode.device_uuid !== senderUUID) {
                const linked: Friend = {
                  ...friendByCode,
                  device_uuid: senderUUID,
                  display_name: incomingMeshMessage.sender_name ?? friendByCode.display_name,
                  last_seen_at: Date.now(),
                  hop_distance: incomingMeshMessage.hop_count ?? 1,
                }
                saveFriend(linked)
                useAppStore.getState().addFriend(linked)
                console.log('[Chat] ✅ Auto-linked sender', normalizedCode, '→', senderUUID)
              }
            }

            const chatMsg: ChatMessage = {
              id: incomingMeshMessage.message_id,
              thread_id: incomingMeshMessage.chat_thread_id ?? incomingMeshMessage.message_id,
              friend_device_uuid: senderUUID,
              body: incomingMeshMessage.body,
              sender_id: senderUUID,
              is_outgoing: false,
              created_at: Date.now(),
              delivered: true,
            }

            saveChatMessage(chatMsg)
            useAppStore.getState().addChatMessage(senderUUID, chatMsg)
            updateFriendLastSeen(senderUUID, Date.now(), incomingMeshMessage.hop_count ?? 1)

            // Add unknown sender as a new friend
            if (!getFriendByUUID(senderUUID)) {
              const newFriend: Friend = {
                friend_code: generateFriendCode(senderUUID),
                device_uuid: senderUUID,
                display_name: incomingMeshMessage.sender_name ??
                  'Friend ' + generateFriendCode(senderUUID),
                last_seen_at: Date.now(),
                hop_distance: incomingMeshMessage.hop_count ?? 1,
                added_at: Date.now(),
              }
              saveFriend(newFriend)
              useAppStore.getState().addFriend(newFriend)
            }

            console.log('[Chat] ✅ Received from:', senderUUID, 'body:', incomingMeshMessage.body)
          }
        })

        unsubConnected = onPeerConnected((data) => {
          useAppStore.getState().setPeerCount(data.peerCount)
          const meshState = useMeshStore.getState()
          if (data.endpointId && !meshState.currentPeers.some((peer) => peer.id === data.endpointId)) {
            // TODO: Update transport from native callback if Nearby module emits BLE vs WIFI_DIRECT metadata.
            meshState.setPeers([
              ...meshState.currentPeers,
              { id: data.endpointId, transport: 'BLE' },
            ])
          }
          if (data.peerCount > 0) {
            void flushPendingMeshQueue()
          }
        })

        unsubDisconnected = onPeerDisconnected((data) => {
          useAppStore.getState().setPeerCount(data.peerCount)
          const meshState = useMeshStore.getState()
          if (data.endpointId) {
            meshState.setPeers(meshState.currentPeers.filter((peer) => peer.id !== data.endpointId))
          }
        })
      } catch (e) {
        console.error('App init error:', e)
      }
    }

    init()

    return () => {
      stopGatewaySync()
      stopBeacon()
      netInfoUnsubscribe?.()
      if (peerRefreshTimer) {
        clearInterval(peerRefreshTimer)
      }
      void stopMesh()
      useAppStore.getState().setMeshActive(false)
      unsubMessage?.()
      unsubConnected?.()
      unsubDisconnected?.()
    }
  }, [])

  useEffect(() => {
    startTelemetryReporter()
    return () => {
      stopTelemetryReporter()
    }
  }, [])

  const handleOnboardingComplete = useCallback(async () => {
    await markOnboardingComplete()
    setShowOnboarding(false)
  }, [])

  const handleOpenChat = useCallback((friend: Friend) => {
    useAppStore.getState().setActiveChatFriend(friend)
    setActiveTab('chat')
  }, [])

  const handleChatBack = useCallback(() => {
    setActiveTab('friends')
  }, [])

  if (!appReady) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingIcon}>🌊</Text>
        <Text style={styles.loadingTitle}>NeighbourNet</Text>
        <Text style={styles.loadingSubtitle}>Offline Mesh SOS</Text>
        <ActivityIndicator size="large" color="#FFFFFF" style={styles.loadingSpinner} />
        {initError ? <Text style={styles.loadingError}>{initError}</Text> : null}
      </View>
    )
  }

  if (showOnboarding) {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />
  }

  const visibleTab = activeTab === 'chat' ? 'friends' : activeTab

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar style="light" />

        <View style={styles.screenContainer}>
          <View style={[styles.screen, activeTab !== 'sos' && styles.hidden]}>
            <SosScreen />
          </View>
          <View style={[styles.screen, activeTab !== 'mesh' && styles.hidden]}>
            <MeshStatusScreen />
          </View>
          <View style={[styles.screen, activeTab !== 'friends' && styles.hidden]}>
            <FriendsScreen onOpenChat={handleOpenChat} />
          </View>
          <View style={[styles.screen, activeTab !== 'profile' && styles.hidden]}>
            <ProfileScreen />
          </View>
          {activeTab === 'chat' ? (
            <View style={styles.screen}>
              <ChatScreen onBack={handleChatBack} />
            </View>
          ) : null}
        </View>

        <TabBar
          activeTab={visibleTab as 'sos' | 'mesh' | 'friends' | 'profile'}
          onTabChange={(tab) => setActiveTab(tab)}
          criticalCount={criticalCount}
        />
      </View>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  screenContainer: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  hidden: {
    display: 'none',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A237E',
  },
  loadingIcon: {
    fontSize: 64,
    marginBottom: 12,
  },
  loadingTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  loadingSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
  loadingSpinner: {
    marginTop: 20,
  },
  loadingError: {
    marginTop: 12,
    color: '#EF5350',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
})

export default App
