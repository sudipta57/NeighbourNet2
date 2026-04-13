import React, { useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { getDisplayName, getMyFriendCode, setDisplayName } from '../services/profileService'
import useAppStore from '../store/useAppStore'

const ProfileScreen = () => {
  const [friendCode, setFriendCode] = useState<string>('----')
  const [displayName, setDisplayNameState] = useState<string>('')

  useEffect(() => {
    getMyFriendCode().then(setFriendCode)
    getDisplayName().then(setDisplayNameState)
  }, [])

  const handleNameChange = (name: string) => {
    setDisplayNameState(name)
    setDisplayName(name)
    useAppStore.getState().setOwnDisplayName(name)
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <Text style={styles.logo}>🌊</Text>
          <Text style={styles.title}>NeighbourNet</Text>
        </View>

        <View style={styles.codeSection}>
          <Text style={styles.codeLabel}>Your Friend Code</Text>
          <View style={styles.digitRow}>
            {friendCode.split('').map((digit, i) => (
              <View key={i} style={styles.digitBox}>
                <Text style={styles.digitText}>{digit}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.codeHint}>Share this code with friends before the event</Text>
        </View>

        <View style={styles.nameSection}>
          <Text style={styles.nameLabel}>Your Name</Text>
          <TextInput
            style={styles.nameInput}
            value={displayName}
            onChangeText={handleNameChange}
            placeholder="Enter your name"
            placeholderTextColor="rgba(255,255,255,0.4)"
            maxLength={40}
            autoCorrect={false}
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logo: {
    fontSize: 56,
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  codeSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  codeLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  digitRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  digitBox: {
    width: 56,
    height: 68,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  digitText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  codeHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
  },
  nameSection: {
    width: '100%',
  },
  nameLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
})

export default ProfileScreen
