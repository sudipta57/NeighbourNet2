import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { WebView } from 'react-native-webview'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import useAppStore from '../store/useAppStore'
import { sendRawMessageJson } from '../services/meshService'
import { startBeaconBroadcast, stopBeaconBroadcast } from '../services/locationBeacon'

interface FriendMapScreenProps {
  onBack: () => void
}

const COLOURS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD']
const MASCOTS = ['🐯', '🦊', '🐻', '🦁', '🐼', '🐨']

type PermissionState = 'checking' | 'granted' | 'denied'

function getPaletteIndex(friendCode: string): number {
  const parsed = Number.parseInt(friendCode, 10)
  if (Number.isNaN(parsed)) {
    return 0
  }
  return Math.abs(parsed) % COLOURS.length
}

function getFriendColour(friendCode: string): string {
  return COLOURS[getPaletteIndex(friendCode)]
}

function getFriendMascot(friendCode: string): string {
  return MASCOTS[getPaletteIndex(friendCode)]
}

function buildLeafletHtml(lat: number, lng: number): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body, #map { width: 100%; height: 100%; background: #FAFBFD; }
          .you-marker {
            position: relative;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: #182A6A;
            border: 3px solid #ffffff;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          }
          .you-marker::after {
            content: '';
            position: absolute;
            left: 50%;
            top: 50%;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            border: 2px solid #182A6A;
            transform: translate(-50%, -50%);
            animation: pulse 2s infinite;
          }
          @keyframes pulse {
            0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([${lat}, ${lng}], 16);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

          var markerLayer = L.layerGroup().addTo(map);

          var meIcon = L.divIcon({
            html: '<div class="you-marker"></div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
            className: ''
          });

          var myMarker = L.marker([${lat}, ${lng}], { icon: meIcon }).addTo(map);
          myMarker.bindPopup('<b>You</b>');

          window.updateFriendMarkers = function(friends) {
            markerLayer.clearLayers();

            var esc = function(value) {
              return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            };

            friends.forEach(function(friend) {
              var stale = friend.ageSeconds > 45;
              var opacity = stale ? 0.5 : 1;

              var friendIcon = L.divIcon({
                html: '<div style="background:' + friend.colour + ';border-radius:50%;width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:22px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);opacity:' + opacity + ';">' + friend.mascot + '</div>',
                iconSize: [44, 44],
                iconAnchor: [22, 22],
                className: ''
              });

              var marker = L.marker([friend.lat, friend.lng], { icon: friendIcon }).addTo(markerLayer);
              var popupAge = stale
                ? '(last seen ' + friend.ageSeconds + 's ago)'
                : friend.ageSeconds + ' seconds ago';

              marker.bindPopup(
                '<b>' + esc(friend.displayName) + '</b><br/>' +
                'Code: ' + esc(friend.friendCode) + '<br/>' +
                popupAge
              );
            });
          };
        </script>
      </body>
    </html>
  `
}

const FriendMapScreen = ({ onBack }: FriendMapScreenProps) => {
  const friendLocations = useAppStore((state) => state.friendLocations)

  const [permissionState, setPermissionState] = useState<PermissionState>('checking')
  const [ownLocation, setOwnLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [nowMs, setNowMs] = useState<number>(Date.now())

  const pulse = useRef(new Animated.Value(1)).current
  const webViewRef = useRef<WebView>(null)

  const subtitle = `${friendLocations.length} friends nearby`

  const markerPayload = useMemo(() => {
    return friendLocations.map((friend) => {
      const ageSeconds = Math.max(0, Math.floor((nowMs - friend.timestamp) / 1000))
      return {
        senderId: friend.senderId,
        displayName: friend.displayName,
        friendCode: friend.friendCode,
        lat: friend.lat,
        lng: friend.lng,
        timestamp: friend.timestamp,
        ageSeconds,
        colour: getFriendColour(friend.friendCode),
        mascot: getFriendMascot(friend.friendCode),
      }
    })
  }, [friendLocations, nowMs])

  const syncOwnLocation = async (): Promise<void> => {
    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    })
    setOwnLocation({
      lat: current.coords.latitude,
      lng: current.coords.longitude,
    })
  }

  const checkPermissions = async (): Promise<void> => {
    const existing = await Location.getForegroundPermissionsAsync()
    if (existing.status !== 'granted') {
      setPermissionState('denied')
      return
    }

    await syncOwnLocation()
    setPermissionState('granted')
  }

  const requestPermission = async (): Promise<void> => {
    const result = await Location.requestForegroundPermissionsAsync()
    if (result.status !== 'granted') {
      setPermissionState('denied')
      return
    }

    await syncOwnLocation()
    setPermissionState('granted')
  }

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
    void checkPermissions()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => {
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (permissionState !== 'granted' || !ownLocation) {
      return
    }

    startBeaconBroadcast(sendRawMessageJson)
    return () => {
      stopBeaconBroadcast()
    }
  }, [permissionState, ownLocation])

  useEffect(() => {
    if (!webViewRef.current || permissionState !== 'granted') {
      return
    }

    const payload = JSON.stringify(markerPayload)
    const script = `window.updateFriendMarkers(${payload}); true;`
    webViewRef.current.injectJavaScript(script)
  }, [markerPayload, permissionState])

  if (permissionState === 'checking') {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Checking location permission...</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (permissionState !== 'granted' || !ownLocation) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={24} color="#182A6A" />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.title}>Friend Map</Text>
            <Text style={styles.subtitle}>0 friends nearby</Text>
          </View>
        </View>

        <View style={styles.permissionCard}>
          <Text style={styles.permissionIcon}>📍</Text>
          <Text style={styles.permissionTitle}>Location access needed</Text>
          <Text style={styles.permissionSubtitle}>
            Required to share your location with friends over the mesh
          </Text>
          <TouchableOpacity onPress={() => void requestPermission()} style={styles.permissionButton}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#182A6A" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Friend Map</Text>
            <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
          </View>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>

      <View style={styles.mapWrap}>
        <View style={[styles.mapContainer, friendLocations.length === 0 && styles.mapDimmed]}>
          <WebView
            ref={webViewRef}
            source={{ html: buildLeafletHtml(ownLocation.lat, ownLocation.lng) }}
            style={styles.webview}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={true}
            originWhitelist={['*']}
          />
        </View>

        {friendLocations.length === 0 ? (
          <View style={styles.emptyOverlay}>
            <Text style={styles.emptyTitle}>No friends nearby</Text>
            <Text style={styles.emptySubtitle}>
              Friends you connect with will appear here automatically
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.bottomSheet}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardsRow}>
          {markerPayload.map((friend) => {
            const ageColor = friend.ageSeconds < 25 ? '#00c896' : friend.ageSeconds < 45 ? '#f5c542' : '#ef5350'
            return (
              <View
                key={friend.senderId}
                style={[styles.friendCard, { borderLeftColor: friend.colour }]}
              >
                <Text style={styles.cardMascot}>{friend.mascot}</Text>
                <Text style={styles.cardName} numberOfLines={1}>
                  {friend.displayName}
                </Text>
                <Text style={styles.cardCode}>Code: {friend.friendCode}</Text>
                <Text style={[styles.cardAge, { color: ageColor }]}>{friend.ageSeconds}s ago</Text>
              </View>
            )
          })}
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FAFBFD',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#7B88A0',
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F3FA',
  },
  headerContent: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#182A6A',
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    color: '#7B88A0',
    fontSize: 13,
    fontWeight: '700',
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4FB99F',
  },
  mapWrap: {
    flex: 1,
    marginHorizontal: 20,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#F0F3FA',
  },
  mapContainer: {
    flex: 1,
  },
  mapDimmed: {
    opacity: 0.4,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  emptyOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: '#182A6A',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySubtitle: {
    marginTop: 8,
    color: '#7B88A0',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    fontWeight: '600',
  },
  bottomSheet: {
    height: 140,
    marginTop: 16,
    marginBottom: 8,
  },
  cardsRow: {
    paddingHorizontal: 20,
    gap: 12,
    alignItems: 'stretch',
  },
  friendCard: {
    width: 140,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: '#F0F3FA',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 2,
  },
  cardMascot: {
    fontSize: 32,
  },
  cardName: {
    marginTop: 6,
    color: '#182A6A',
    fontSize: 15,
    fontWeight: '800',
  },
  cardCode: {
    marginTop: 2,
    color: '#7B88A0',
    fontSize: 11,
    fontWeight: '700',
  },
  cardAge: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '800',
  },
  permissionCard: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F0F3FA',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 3,
  },
  permissionIcon: {
    fontSize: 32,
    marginBottom: 10,
  },
  permissionTitle: {
    color: '#182A6A',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  permissionSubtitle: {
    marginTop: 8,
    color: '#7B88A0',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    fontWeight: '600',
  },
  permissionButton: {
    marginTop: 16,
    backgroundColor: '#0D1C4A',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  permissionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
})

export default FriendMapScreen
