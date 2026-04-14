import React, { useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { getDisplayName, getMyFriendCode, setDisplayName } from '../services/profileService'
import useAppStore from '../store/useAppStore'

const ProfileScreen = () => {
  const [friendCode, setFriendCode] = useState<string>('----')
  const [displayName, setDisplayNameState] = useState<string>('')
  const [activeProtocol, setActiveProtocol] = useState<'CONCERT' | 'TREKKING' | 'DISASTER'>('CONCERT')

  useEffect(() => {
    getMyFriendCode().then(setFriendCode)
    getDisplayName().then(setDisplayNameState)
  }, [])

  const handleNameChange = (name: string) => {
    setDisplayNameState(name)
    setDisplayName(name)
    useAppStore.getState().setOwnDisplayName(name)
  }

  // Generate some static bar heights for the decorative signal diagram
  const barHeights = [
    25, 35, 45, 30, 85, 75, 40, 70, 75, 55, 60, 40, 20, 15, 45, 60, 65, 85,
  ]

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Global Header */}
      <View style={styles.appHeader}>
        <View style={styles.appHeaderLeft}>
          <MaterialCommunityIcons name="waves" size={24} color="#182A6A" />
          <Text style={styles.appHeaderTitle}>NeighbourNet</Text>
        </View>
        <Ionicons name="radio-outline" size={24} color="#182A6A" />
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.inner}
        >
          {/* Main Blue Card */}
          <View style={styles.profileCard}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatarShape}>
                <Ionicons name="person" size={60} color="#1A237E" />
              </View>
            </View>

            <TextInput
              style={styles.nameInput}
              value={displayName}
              onChangeText={handleNameChange}
              placeholder="Enter your name"
              placeholderTextColor="rgba(255,255,255,0.6)"
              maxLength={40}
              autoCorrect={false}
            />
            <Text style={styles.subtitleText}>HOW OTHERS SEE YOU</Text>

            <View style={styles.codeRow}>
              {friendCode.split('').map((digit, i) => (
                <View key={i} style={styles.digitBox}>
                  <Text style={styles.digitText}>{digit}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.globalMeshText}>GLOBAL MESH ID</Text>
          </View>

          {/* Active Protocol Section */}
          <View style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>ACTIVE PROTOCOL</Text>
            <View style={styles.protocolRow}>
              <TouchableOpacity
                style={[styles.protocolBtn, activeProtocol === 'CONCERT' && styles.protocolBtnActive]}
                onPress={() => setActiveProtocol('CONCERT')}
              >
                <MaterialCommunityIcons
                  name="storefront-outline"
                  size={20}
                  color={activeProtocol === 'CONCERT' ? '#FFFFFF' : '#1A237E'}
                />
                <Text style={[styles.protocolText, activeProtocol === 'CONCERT' && styles.protocolTextActive]}>
                  CONCERT
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.protocolBtn, activeProtocol === 'TREKKING' && styles.protocolBtnActive]}
                onPress={() => setActiveProtocol('TREKKING')}
              >
                <MaterialCommunityIcons
                  name="hiking"
                  size={20}
                  color={activeProtocol === 'TREKKING' ? '#FFFFFF' : '#455A64'}
                />
                <Text style={[styles.protocolText, activeProtocol === 'TREKKING' && styles.protocolTextActive]}>
                  TREKKING
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.protocolBtn, activeProtocol === 'DISASTER' && styles.protocolBtnActive]}
                onPress={() => setActiveProtocol('DISASTER')}
              >
                <MaterialCommunityIcons
                  name="alert-circle"
                  size={20}
                  color={activeProtocol === 'DISASTER' ? '#FFFFFF' : '#455A64'}
                />
                <Text style={[styles.protocolText, activeProtocol === 'DISASTER' && styles.protocolTextActive]}>
                  DISASTER
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Signal History */}
          <View style={styles.signalCard}>
            <View style={styles.signalHeaderRow}>
              <View>
                <Text style={styles.sectionSubtitle}>SIGNAL HISTORY</Text>
                <Text style={styles.signalTitle}>Last 30 Minutes</Text>
              </View>
              <View style={styles.meshActiveBadge}>
                <View style={styles.greenDot} />
                <Text style={styles.meshActiveText}>MESH ACTIVE</Text>
              </View>
            </View>

            <View style={styles.chartWrap}>
              {barHeights.map((h, index) => (
                <View
                  key={index}
                  style={[
                    styles.chartBar,
                    { height: `${h}%` as any, opacity: 0.4 + (index / barHeights.length) * 0.6 },
                  ]}
                />
              ))}
            </View>
          </View>

          {/* Share Profile QR */}
          <TouchableOpacity style={styles.shareBtn}>
            <MaterialCommunityIcons name="qrcode-scan" size={20} color="#FFFFFF" />
            <Text style={styles.shareBtnText}>Share Profile QR</Text>
          </TouchableOpacity>

          {/* Settings & Offline Actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtn}>
              <Ionicons name="settings-sharp" size={16} color="#182A6A" />
              <Text style={styles.actionBtnText}>SETTINGS</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn}>
              <MaterialCommunityIcons name="logout-variant" size={18} color="#182A6A" />
              <Text style={styles.actionBtnText}>GO OFFLINE</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F3F6FD', // Light greyish blue
  },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#F3F6FD',
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
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  inner: {
    width: '100%',
  },
  profileCard: {
    backgroundColor: '#182A6A',
    borderRadius: 28,
    paddingTop: 36,
    paddingBottom: 36,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#182A6A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 8,
    overflow: 'hidden',
  },
  avatarWrap: {
    marginBottom: 20,
  },
  avatarShape: {
    width: 120,
    height: 120,
    backgroundColor: '#F3F6FD',
    borderRadius: 24,
    transform: [{ rotate: '45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameInput: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
    minWidth: 200,
  },
  subtitleText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 28,
  },
  codeRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  digitBox: {
    width: 56,
    height: 64,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  digitText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#182A6A',
  },
  globalMeshText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1.5,
    fontWeight: '600',
  },
  sectionWrap: {
    marginTop: 32,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#7B88A0',
    marginBottom: 16,
  },
  protocolRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  protocolBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    backgroundColor: '#E6ECF9',
    borderRadius: 16,
    gap: 8,
  },
  protocolBtnActive: {
    backgroundColor: '#182A6A',
  },
  protocolText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#182A6A',
  },
  protocolTextActive: {
    color: '#FFFFFF',
  },
  signalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    marginTop: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  signalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  sectionSubtitle: {
    fontSize: 10,
    color: '#A0ADC9',
    letterSpacing: 1,
    fontWeight: '700',
    marginBottom: 4,
  },
  signalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#182A6A',
  },
  meshActiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1FD8A4',
  },
  meshActiveText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1FD8A4',
  },
  chartWrap: {
    height: 80,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  chartBar: {
    width: 10,
    backgroundColor: '#4FB99F',
    borderRadius: 4,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#182A6A',
    borderRadius: 14,
    paddingVertical: 18,
    marginTop: 24,
    gap: 10,
  },
  shareBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    backgroundColor: '#E6ECF9',
    borderRadius: 14,
    gap: 8,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#182A6A',
  },
})

export default ProfileScreen
