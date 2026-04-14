import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  StatusBar,
  Vibration,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { v4 as uuidv4 } from 'uuid'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import useAppStore from '../store/useAppStore'
import { broadcastMessage } from '../services/meshService'
import { triggerManualSync } from '../services/gatewaySync'
import { enqueuePendingMeshForward } from '../services/meshRelay'
import { triageMessage } from '../services/triageEngine'
import { SOS_TEMPLATES } from '../types/message'
import { PRIORITY_COLORS, PRIORITY_LABELS, INITIAL_TTL } from '../constants/priorities'
import { Message, PriorityTier } from '../types/message'

const HARD_CODED_USER_ID = 'neighbournet-demo-user'

const SosScreen = () => {
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null)
  const [customText, setCustomText] = useState('')
  const [locationHint, setLocationHint] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [lastResult, setLastResult] = useState<{ tier: PriorityTier; score: number } | null>(null)
  const [locationGranted, setLocationGranted] = useState(false)

  // Decorative UI layout states
  const [contextType, setContextType] = useState<'disaster' | 'trek'>('disaster')
  const [broadcastTarget, setBroadcastTarget] = useState<'Everyone' | 'Friends' | 'Directional'>('Everyone')

  const addMessage = useAppStore((state) => state.addMessage)

  useEffect(() => {
    const requestLocationPermission = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()

      if (status === 'granted') {
        setLocationGranted(true)
      } else {
        setLocationGranted(false)
        Alert.alert(
          'Location Permission',
          'Location not available. Your message will be sent without GPS coordinates.\nYou can add a text landmark instead.'
        )
      }
    }

    requestLocationPermission()
  }, [])

  const getMessageBody = useCallback((): string => {
    if (customText.trim().length > 0) {
      return customText.trim()
    }
    if (selectedTemplate !== null) {
      const template = SOS_TEMPLATES[selectedTemplate]
      return `${template.label} (${template.labelEn})`
    }
    if (locationHint.trim().length > 0) {
      // Fallback if they didn't select a quick tile but typed something
      return `Custom SOS roughly at: ${locationHint}`
    }
    return ''
  }, [customText, selectedTemplate, locationHint])

  const handleSendSOS = useCallback(async () => {
    try {
      const body = getMessageBody().trim()

      if (!body) {
        Alert.alert('Please select a Quick Broadcast option or type your location.')
        return
      }

      setIsSending(true)
      Vibration.vibrate(100)

      let lat: number | null = null
      let lng: number | null = null

      if (locationGranted) {
        try {
          const locationTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Location timeout')), 5000)
          )
          const position = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            locationTimeout,
          ])
          // @ts-ignore
          lat = position.coords.latitude
          // @ts-ignore
          lng = position.coords.longitude
        } catch (_error) {
          lat = null
          lng = null
        }
      }

      const { tier, priority_score } = await triageMessage(body)
      const now = new Date().toISOString()

      const message: Message = {
        message_id: uuidv4(),
        body,
        sender_id: HARD_CODED_USER_ID,
        message_type: 'sos',
        gps_lat: lat,
        gps_lng: lng,
        location_hint: locationHint,
        priority_score,
        priority_tier: tier,
        ttl: INITIAL_TTL,
        hop_count: 0,
        created_at: now,
        last_hop_at: now,
        synced: false,
      }

      addMessage(message)

      void triggerManualSync().catch((error) => {
        console.error('Failed to trigger immediate gateway sync:', error)
      })

      try {
        const recipients = await broadcastMessage(message)
        if (recipients <= 0) {
          await enqueuePendingMeshForward(message.message_id)
        }
      } catch (error) {
        console.error('Failed to broadcast SOS over mesh:', error)
        await enqueuePendingMeshForward(message.message_id)
      }

      setLastResult({ tier, score: priority_score })
      Vibration.vibrate(Platform.OS === 'ios' ? [0, 100, 50, 100] : [0, 100, 50, 100])
      setIsSending(false)

      Alert.alert(
        PRIORITY_LABELS[tier],
        `Your SOS has been queued.\nPriority: ${tier}\nIt will be forwarded to nearby phones automatically.`
      )

      setSelectedTemplate(null)
      setCustomText('')
      setLocationHint('')
    } catch (_error) {
      setIsSending(false)
      Alert.alert('Failed to send SOS. Please try again.')
    }
  }, [addMessage, getMessageBody, locationGranted, locationHint, customText])

  const isSendDisabled = isSending || getMessageBody().trim().length === 0

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar barStyle="dark-content" backgroundColor="#FAFBFD" />

      {/* Global Header */}
      <View style={styles.appHeader}>
        <View style={styles.headerLeftWrap}>
          <MaterialCommunityIcons name="waves" size={24} color="#182A6A" />
          <Text style={styles.appHeaderTitle}>NeighbourNet</Text>
        </View>
        <View style={styles.headerRightWrap}>
          <View style={styles.offlinePill}>
            <View style={styles.redDot} />
            <Text style={styles.offlinePillText}>OFFLINE SOS</Text>
          </View>
          <Ionicons name="radio-outline" size={24} color="#182A6A" />
        </View>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent} 
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {lastResult !== null && (
          <View style={[styles.resultBanner, { backgroundColor: PRIORITY_COLORS[lastResult.tier] }]}>
            <Text style={styles.resultText}>
              Last message: {PRIORITY_LABELS[lastResult.tier]} (score: {lastResult.score.toFixed(2)})
            </Text>
          </View>
        )}

        {/* Context Selector */}
        <View style={styles.sectionMargin}>
          <Text style={styles.sectionHeader}>SELECT CONTEXT <Text style={styles.sectionHeaderBn}>/ প্রেক্ষাপট নির্বাচন করুন</Text></Text>
          <View style={styles.contextRow}>
            <TouchableOpacity 
              style={[styles.contextBtn, contextType === 'disaster' && styles.contextBtnActive]}
              onPress={() => setContextType('disaster')}
            >
              <MaterialCommunityIcons name="alert-circle" size={20} color={contextType === 'disaster' ? '#FFF' : '#4F5C7A'} />
              <View style={styles.contextTxtWrap}>
                 <Text style={[styles.contextTitle, contextType === 'disaster' && styles.contextTitleActive]}>Disaster /</Text>
                 <Text style={[styles.contextTitleBn, contextType === 'disaster' && styles.contextTitleBnActive]}>দুর্যোগ</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity 
               style={[styles.contextBtn, contextType === 'trek' && styles.contextBtnActive]}
               onPress={() => setContextType('trek')}
            >
              <MaterialCommunityIcons name="hiking" size={20} color={contextType === 'trek' ? '#FFF' : '#4F5C7A'} />
              <Text style={[styles.contextTitle, contextType === 'trek' && styles.contextTitleActive]}>Trek / ভ্রমণ</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Signal Strength */}
        <View style={styles.signalCard}>
           <View>
             <Text style={styles.signalSub}>MESH SIGNAL STRENGTH</Text>
             <Text style={styles.signalTitle}>Active Node Connection</Text>
           </View>
           <View style={styles.barsWrap}>
              <View style={[styles.signalBar, { height: 10 }]} />
              <View style={[styles.signalBar, { height: 16 }]} />
              <View style={[styles.signalBar, { height: 26 }]} />
              <View style={[styles.signalBar, { height: 36 }]} />
           </View>
        </View>

        {/* Quick Broadcast */}
        <View style={styles.sectionMargin}>
           <Text style={styles.sectionHeader}>QUICK BROADCAST <Text style={styles.sectionHeaderBn}>/ দ্রুত বার্তা</Text></Text>
           <View style={styles.gridRow}>
             <TouchableOpacity 
               style={[styles.gridCard, styles.gridCardTrapped, selectedTemplate === 0 && styles.gridCardSelected]}
               onPress={() => {
                 setSelectedTemplate(0)
                 setCustomText('')
               }}
             >
               <MaterialCommunityIcons name="home-flood" size={22} color="#D32F2F" />
               <Text style={styles.cardTitleRed}>Trapped</Text>
               <Text style={styles.cardSubtitleRed}>আটকে পড়েছি</Text>
             </TouchableOpacity>

             <TouchableOpacity 
               style={[styles.gridCard, styles.gridCardBlue, selectedTemplate === 1 && styles.gridCardSelected]}
               onPress={() => {
                 setSelectedTemplate(1)
                 setCustomText('')
               }}
             >
               <MaterialCommunityIcons name="medical-bag" size={22} color="#182A6A" />
               <Text style={styles.cardTitleBlue}>Medical</Text>
               <Text style={styles.cardSubtitleBlue}>চিকিৎসা প্রয়োজন</Text>
             </TouchableOpacity>
           </View>

           <View style={styles.gridRow}>
             <TouchableOpacity 
               style={[styles.gridCard, styles.gridCardLight, selectedTemplate === 2 && styles.gridCardSelected]}
               onPress={() => {
                 setSelectedTemplate(2)
                 setCustomText('')
               }}
             >
               <MaterialCommunityIcons name="water" size={22} color="#182A6A" />
               <Text style={styles.cardTitleBlue}>No Food/Water</Text>
               <Text style={styles.cardSubtitleBlue}>খাদ্য/জল নেই</Text>
             </TouchableOpacity>

             <TouchableOpacity 
               style={[styles.gridCard, styles.gridCardLight, selectedTemplate === 3 && styles.gridCardSelected]}
               onPress={() => {
                 setSelectedTemplate(3)
                 setCustomText('')
               }}
             >
               <MaterialCommunityIcons name="human-cane" size={22} color="#182A6A" />
               <Text style={styles.cardTitleBlue}>Elderly</Text>
               <Text style={styles.cardSubtitleBlue}>বয়স্ক ব্যক্তি</Text>
             </TouchableOpacity>
           </View>

           {/* I am safe */}
           <TouchableOpacity 
             style={[styles.safeButton, selectedTemplate === 4 && styles.safeButtonSelected]} 
             onPress={() => {
               setSelectedTemplate(4)
               setCustomText('')
             }}
           >
             <View style={styles.safeLeft}>
               <View style={styles.safeIconWrap}>
                 <MaterialCommunityIcons name="check-bold" size={16} color="#004D40" />
               </View>
               <View>
                 <Text style={styles.safeTitle}>I am Safe / আমি নিরাপদ</Text>
                 <Text style={styles.safeSubtitle}>Notify all nodes of your status</Text>
               </View>
             </View>
             <MaterialCommunityIcons name="arrow-right" size={20} color="#1FD8A4" />
           </TouchableOpacity>
        </View>

        {/* Broadcast Target */}
        <View style={styles.sectionMargin}>
           <Text style={styles.sectionHeader}>BROADCAST TARGET <Text style={styles.sectionHeaderBn}>/ সম্প্রচার লক্ষ্য</Text></Text>
           <View style={styles.targetBar}>
              {['Everyone', 'Friends', 'Directional'].map((t) => (
                <TouchableOpacity 
                  key={t}
                  style={[styles.targetBtn, broadcastTarget === t && styles.targetBtnActive]}
                  onPress={() => setBroadcastTarget(t as any)}
                >
                  <Text style={[styles.targetTxt, broadcastTarget === t && styles.targetTxtActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
           </View>

           {/* Decorative scanning dial */}
           <View style={styles.dialWrap}>
             <Text style={styles.dialNorth}>N</Text>
             <View style={styles.dialCircle}>
               <View style={styles.dialNeedleWrap}>
                 <View style={styles.dialCenterDot} />
                 <View style={styles.dialNeedle} />
               </View>
             </View>
             <Text style={styles.dialStatus}>SCANNING 310° NW</Text>
           </View>
        </View>

        {/* Custom Message */}
        <View style={styles.sectionMargin}>
           <View style={styles.landmarkHeaderRow}>
             <Text style={styles.sectionHeader}>CUSTOM MESSAGE <Text style={styles.sectionHeaderBn}>/ নিজে লিখুন</Text></Text>
             <Text style={styles.charLimit}>{customText.length} / 500</Text>
           </View>
           
           <TextInput
             style={styles.landmarkInput}
             placeholder="Describe your situation... (max 500 characters)"
             placeholderTextColor="#90A4AE"
             multiline
             maxLength={500}
             value={customText}
             onChangeText={(t) => {
               setCustomText(t)
               setSelectedTemplate(null)
             }}
             textAlignVertical="top"
           />
        </View>

        {/* Landmark & Details */}
        <View style={styles.sectionMargin}>
           <View style={styles.landmarkHeaderRow}>
             <Text style={styles.sectionHeader}>LANDMARK & DETAILS <Text style={styles.sectionHeaderBn}>/ বিবরণ</Text></Text>
             <Text style={styles.charLimit}>{locationHint.length} / 500</Text>
           </View>
           
           <TextInput
             style={styles.landmarkInput}
             placeholder="Describe your location or landmarks nearby... (e.g., Near the red temple)"
             placeholderTextColor="#90A4AE"
             multiline
             maxLength={500}
             value={locationHint}
             onChangeText={(t) => setLocationHint(t)}
             textAlignVertical="top"
           />
        </View>

        {/* Submit */}
        <TouchableOpacity 
          style={[styles.sendButton, isSendDisabled && styles.sendButtonDisabled]}
          onPress={handleSendSOS}
          disabled={isSendDisabled}
        >
          {isSending ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <View style={styles.sendLayout}>
               <MaterialCommunityIcons name="bullhorn" size={24} color="#FFF" />
               <Text style={styles.sendButtonText}>BROADCAST SOS</Text>
            </View>
          )}
        </TouchableOpacity>

      </ScrollView>
      </KeyboardAvoidingView>
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
  headerRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    gap: 6,
  },
  redDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D32F2F',
  },
  offlinePillText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#D32F2F',
    letterSpacing: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 240, // Increased to ensure the bottom inputs can scroll above the keyboard
  },
  resultBanner: {
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  resultText: {
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
  },
  sectionMargin: {
    marginBottom: 24,
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#7B88A0',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  sectionHeaderBn: {
    fontWeight: '400',
    fontSize: 11,
  },
  contextRow: {
    flexDirection: 'row',
    gap: 12,
  },
  contextBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F3FA',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 10,
  },
  contextBtnActive: {
    backgroundColor: '#0D1C4A',
  },
  contextTxtWrap: {
    alignItems: 'center',
  },
  contextTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4F5C7A',
  },
  contextTitleActive: {
    color: '#FFFFFF',
  },
  contextTitleBn: {
    fontSize: 14,
    color: '#4F5C7A',
  },
  contextTitleBnActive: {
    color: '#FFFFFF',
  },
  signalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#0A1C4F',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 3,
  },
  signalSub: {
    fontSize: 9,
    fontWeight: '800',
    color: '#A0ADC9',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  signalTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000',
  },
  barsWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 36,
  },
  signalBar: {
    width: 6,
    backgroundColor: '#4FB99F',
    borderRadius: 3,
    opacity: 0.8,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  gridCard: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  gridCardSelected: {
    borderColor: '#4FB99F', // highlight color
  },
  gridCardTrapped: {
    backgroundColor: '#FFEAE9',
  },
  gridCardBlue: {
    backgroundColor: '#E4EBFC',
  },
  gridCardLight: {
    backgroundColor: '#EAEFF9',
  },
  cardTitleRed: {
    color: '#D32F2F',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 10,
  },
  cardSubtitleRed: {
    color: '#D32F2F',
    fontSize: 12,
    marginTop: 2,
  },
  cardTitleBlue: {
    color: '#182A6A',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 10,
  },
  cardSubtitleBlue: {
    color: '#4F5C7A',
    fontSize: 12,
    marginTop: 2,
  },
  safeButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#004D40',
    borderRadius: 16,
    padding: 16,
    marginTop: 4,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  safeButtonSelected: {
    borderColor: '#1FD8A4',
  },
  safeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  safeIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1FD8A4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  safeTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  safeSubtitle: {
    color: '#80CBC4',
    fontSize: 11,
    marginTop: 2,
  },
  targetBar: {
    flexDirection: 'row',
    backgroundColor: '#F0F3FA',
    borderRadius: 16,
    padding: 4,
  },
  targetBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 12,
  },
  targetBtnActive: {
    backgroundColor: '#0D1C4A',
  },
  targetTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4F5C7A',
  },
  targetTxtActive: {
    color: '#FFFFFF',
  },
  dialWrap: {
    marginTop: 24,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F0F3FA',
  },
  dialNorth: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7B88A0',
    marginBottom: -4,
    zIndex: 10,
    backgroundColor: '#FFF',
    paddingHorizontal: 4,
  },
  dialCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#E8EDF9',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialNeedleWrap: {
    position: 'absolute',
    width: 80,
    height: 80,
    alignItems: 'center',
    transform: [{ rotate: '-50deg' }], // points NW roughly 310 deg
  },
  dialCenterDot: {
    position: 'absolute',
    top: 36,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0D1C4A',
  },
  dialNeedle: {
    position: 'absolute',
    top: 16,
    width: 3,
    height: 24,
    backgroundColor: '#182A6A',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  dialStatus: {
    fontSize: 10,
    fontWeight: '800',
    color: '#2855F4',
    marginTop: 16,
    letterSpacing: 1.2,
  },
  landmarkHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  charLimit: {
    fontSize: 10,
    fontWeight: '700',
    color: '#A0ADC9',
  },
  landmarkInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    minHeight: 120,
    padding: 16,
    fontSize: 14,
    color: '#182A6A',
    borderWidth: 1,
    borderColor: '#F0F3FA',
  },
  sendButton: {
    backgroundColor: '#AA1B1B', // Dark red
    borderRadius: 16,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#AA1B1B',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },
  sendLayout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
})

export default SosScreen
