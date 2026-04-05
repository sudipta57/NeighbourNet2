import React from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
} from 'react-native'
import { WebView } from 'react-native-webview'

interface Props {
  latitude: number
  longitude: number
  label: string
  isOutgoing: boolean
}

const LocationMapCard: React.FC<Props> = ({
  latitude,
  longitude,
  label,
  isOutgoing,
}) => {
  const pinColor = isOutgoing ? '#1565C0' : '#E53935'
  
  const mapHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" 
          content="width=device-width, initial-scale=1.0, 
                   maximum-scale=1.0, user-scalable=no">
        <link 
          rel="stylesheet" 
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossorigin=""/>
        <script 
          src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
          integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV/XN2/Cx4="
          crossorigin=""></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { background: #e8e0d8; }
          #map { 
            width: 100vw; 
            height: 100vh;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            touchZoom: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
          }).setView([${latitude}, ${longitude}], 16);
          
          L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            { maxZoom: 19 }
          ).addTo(map);
          
          var icon = L.divIcon({
            html: '<div style="width:16px;height:16px;border-radius:50%;background:${pinColor};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
            className: ''
          });
          
          L.marker([${latitude}, ${longitude}], { icon: icon }).addTo(map);
        </script>
      </body>
      </html>
    `

  const openInMaps = () => {
    const url = Platform.OS === 'android'
      ? `geo:${latitude},${longitude}?q=${latitude},${longitude}(Friend Location)`
      : `maps://?q=${latitude},${longitude}`
    Linking.openURL(url).catch(() => {
      Linking.openURL(
        `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}&zoom=16`
      )
    })
  }

  return (
    <TouchableOpacity 
      onPress={openInMaps}
      activeOpacity={0.9}
    >
      <View style={styles.card}>
        <View style={styles.mapContainer}>
          <WebView
            source={{ html: mapHtml }}
            style={styles.map}
            scrollEnabled={false}
            bounces={false}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={styles.mapPlaceholder}>
                <Text style={styles.mapPlaceholderText}>
                  Loading map...
                </Text>
              </View>
            )}
            renderError={() => (
              <View style={styles.mapPlaceholder}>
                <Text style={styles.mapPlaceholderText}>
                  📍 Map unavailable offline
                </Text>
              </View>
            )}
          />
        </View>
        <View style={[
          styles.labelRow,
          { backgroundColor: isOutgoing ? '#1A237E' : '#FFFFFF' }
        ]}>
          <Text style={[
            styles.labelText,
            { color: isOutgoing ? '#FFFFFF' : '#212121' }
          ]}>
            📍 {label}
          </Text>
          <Text style={[
            styles.tapHint,
            { color: isOutgoing ? 'rgba(255,255,255,0.7)' : '#757575' }
          ]}>
            Tap to open in Maps
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    width: 240,
    borderRadius: 12,
    overflow: 'hidden',
    marginVertical: 4,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  mapContainer: {
    width: 240,
    height: 160,
    backgroundColor: '#e8e0d8',
  },
  map: {
    width: 240,
    height: 160,
    backgroundColor: 'transparent',
  },
  mapPlaceholder: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e8e0d8',
  },
  mapPlaceholderText: {
    color: '#757575',
    fontSize: 13,
  },
  labelRow: {
    padding: 8,
  },
  labelText: {
    fontSize: 13,
    fontWeight: '500',
  },
  tapHint: {
    fontSize: 10,
    marginTop: 2,
  },
})

export default LocationMapCard
