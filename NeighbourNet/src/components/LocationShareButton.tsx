import React, { useState } from 'react'
import { ActivityIndicator, Alert, StyleSheet, TouchableOpacity, Text } from 'react-native'
import * as Location from 'expo-location'

interface LocationShareButtonProps {
  onLocationShared: (lat: number, lng: number, label: string) => void
  disabled?: boolean
}

const LocationShareButton = ({ onLocationShared, disabled }: LocationShareButtonProps) => {
  const [loading, setLoading] = useState(false)

  const handlePress = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Location permission is required to share your position.')
      return
    }

    setLoading(true)
    try {
      const location = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('GPS timeout')), 10000)
        ),
      ])
      const label = `${location.coords.latitude.toFixed(4)}, ${location.coords.longitude.toFixed(4)}`
      onLocationShared(location.coords.latitude, location.coords.longitude, label)
    } catch (e) {
      Alert.alert('GPS unavailable', 'Could not get location. Try moving outdoors or near a window.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <TouchableOpacity
      style={[styles.btn, disabled && styles.btnDisabled]}
      onPress={handlePress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Text style={styles.icon}>📍</Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1565C0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  btnDisabled: {
    backgroundColor: '#9E9E9E',
  },
  icon: {
    fontSize: 20,
  },
})

export default LocationShareButton
