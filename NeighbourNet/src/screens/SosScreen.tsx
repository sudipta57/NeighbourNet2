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
	SafeAreaView,
	StatusBar,
	Vibration,
	Platform,
} from 'react-native'
import * as Location from 'expo-location'
import { v4 as uuidv4 } from 'uuid'
import useAppStore from '../store/useAppStore'
import { broadcastMessage } from '../services/meshService'
import { triggerManualSync } from '../services/gatewaySync'
import { enqueuePendingMeshForward } from '../services/meshRelay'
import { triageMessage } from '../services/triageEngine'
import { SOS_TEMPLATES } from '../types/message'
import {
	PRIORITY_COLORS,
	PRIORITY_LABELS,
	INITIAL_TTL,
} from '../constants/priorities'
import { Message, PriorityTier } from '../types/message'

const HARD_CODED_USER_ID = 'neighbournet-demo-user'

const SosScreen = () => {
	const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null)
	const [customText, setCustomText] = useState('')
	const [locationHint, setLocationHint] = useState('')
	const [isSending, setIsSending] = useState(false)
	const [lastResult, setLastResult] = useState<{ tier: PriorityTier; score: number } | null>(null)
	const [locationGranted, setLocationGranted] = useState(false)

	const addMessage = useAppStore((state) => state.addMessage)
	const deviceId = useAppStore((state) => state.deviceId)
	const queueDepth = useAppStore((state) => state.queueDepth)

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
		if (selectedTemplate !== null) {
			const template = SOS_TEMPLATES[selectedTemplate]
			return `${template.label} (${template.labelEn})`
		}

		if (customText.trim().length > 0) {
			return customText
		}

		return ''
	}, [selectedTemplate, customText])

	const handleSendSOS = useCallback(async () => {
		try {
			const body = getMessageBody().trim()

			if (!body) {
				Alert.alert('Please select a template or type a message')
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
						Location.getCurrentPositionAsync({
							accuracy: Location.Accuracy.Balanced,
						}),
						locationTimeout,
					])
					lat = position.coords.latitude
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
		} catch (_error) {
			setIsSending(false)
			Alert.alert('Failed to send SOS. Please try again.')
		}
	}, [addMessage, getMessageBody, locationGranted, locationHint])

	const isSendDisabled = isSending || getMessageBody().trim().length === 0

	return (
		<SafeAreaView style={styles.container}>
			<StatusBar barStyle="light-content" backgroundColor="#000000" />

			<View style={styles.header}>
				<View>
					<Text style={styles.appName}>NeighbourNet</Text>
					<Text style={styles.subtitle}>Offline Mesh SOS</Text>
				</View>
				<View style={styles.queueBadge}>
					<Text style={styles.queueCount}>{queueDepth}</Text>
					<Text style={styles.queueLabel}>queued</Text>
				</View>
			</View>

			{lastResult !== null && (
				<View style={[styles.resultBanner, { backgroundColor: PRIORITY_COLORS[lastResult.tier] }]}> 
					<Text style={styles.resultText}>
						Last message: {PRIORITY_LABELS[lastResult.tier]} (score: {lastResult.score.toFixed(2)})
					</Text>
				</View>
			)}

			<ScrollView contentContainerStyle={styles.contentContainer}>
				<Text style={styles.sectionTitle}>Select situation / পরিস্থিতি বেছে নিন</Text>
				{SOS_TEMPLATES.map((template, index) => {
					const isSelected = selectedTemplate === index
					return (
						<TouchableOpacity
							key={`${template.label}-${index}`}
							style={[
								styles.templateCard,
								{
									borderColor: isSelected ? '#C62828' : '#E0E0E0',
									backgroundColor: isSelected ? '#FFEBEE' : '#FFFFFF',
								},
							]}
							onPress={() => {
								setSelectedTemplate(index)
								setCustomText('')
							}}
							activeOpacity={0.8}
						>
							<View style={styles.templateTextWrap}>
								<Text style={styles.templateLabel}>{template.label}</Text>
								<Text style={styles.templateLabelEn}>{template.labelEn}</Text>
							</View>
							{isSelected && <Text style={styles.checkmark}>✓</Text>}
						</TouchableOpacity>
					)
				})}

				<View style={styles.orDividerContainer}>
					<View style={styles.dividerLine} />
					<Text style={styles.orText}>OR / অথবা</Text>
					<View style={styles.dividerLine} />
				</View>

				<Text style={styles.sectionTitle}>Type your own message / নিজে লিখুন</Text>
				<TextInput
					style={styles.customInput}
					placeholder="Describe your situation... (max 500 characters)"
					multiline
					maxLength={500}
					value={customText}
					onChangeText={(text) => {
						setCustomText(text)
						setSelectedTemplate(null)
					}}
					textAlignVertical="top"
				/>
				<Text style={styles.charCounter}>{customText.length}/500</Text>

				<Text style={styles.sectionTitle}>Landmark (optional) / কাছের জায়গার নাম</Text>
				<TextInput
					style={styles.locationInput}
					placeholder="e.g. near Basirhat station, Block 4"
					value={locationHint}
					onChangeText={setLocationHint}
				/>
				<Text style={styles.locationHintText}>
					{locationGranted
						? '📍 GPS will be attached automatically'
						: '⚠️ No GPS — please describe your location above'}
				</Text>

				<TouchableOpacity
					style={[styles.sendButton, isSendDisabled && styles.sendButtonDisabled]}
					onPress={handleSendSOS}
					disabled={isSendDisabled}
					activeOpacity={0.85}
				>
					{isSending ? (
						<ActivityIndicator color="#FFFFFF" size="small" />
					) : (
						<>
							<Text style={styles.sendButtonTitle}>SEND SOS</Text>
							<Text style={styles.sendButtonSubtitle}>সাহায্যের জন্য পাঠান</Text>
						</>
					)}
				</TouchableOpacity>
			</ScrollView>
		</SafeAreaView>
	)
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#F5F5F5',
	},
	header: {
		backgroundColor: '#1A237E',
		padding: 16,
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	appName: {
		color: '#FFFFFF',
		fontSize: 22,
		fontWeight: '700',
	},
	subtitle: {
		color: '#B0BEC5',
		fontSize: 13,
		marginTop: 2,
	},
	queueBadge: {
		backgroundColor: '#FFFFFF',
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 14,
		alignItems: 'center',
		minWidth: 72,
	},
	queueCount: {
		color: '#1A237E',
		fontSize: 18,
		fontWeight: '700',
		lineHeight: 20,
	},
	queueLabel: {
		color: '#616161',
		fontSize: 11,
		marginTop: 2,
	},
	resultBanner: {
		width: '100%',
		paddingVertical: 10,
		paddingHorizontal: 12,
	},
	resultText: {
		color: '#FFFFFF',
		textAlign: 'center',
		fontSize: 14,
		fontWeight: '600',
	},
	contentContainer: {
		paddingTop: 16,
		paddingHorizontal: 16,
		paddingBottom: 24,
	},
	sectionTitle: {
		fontSize: 16,
		fontWeight: '700',
		color: '#212121',
		marginBottom: 10,
		marginTop: 8,
	},
	templateCard: {
		borderWidth: 1,
		borderRadius: 10,
		padding: 14,
		marginBottom: 10,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	templateTextWrap: {
		flex: 1,
		paddingRight: 8,
	},
	templateLabel: {
		fontSize: 18,
		fontWeight: '700',
		color: '#212121',
	},
	templateLabelEn: {
		marginTop: 4,
		fontSize: 13,
		color: '#757575',
	},
	checkmark: {
		color: '#C62828',
		fontSize: 22,
		fontWeight: '700',
	},
	orDividerContainer: {
		flexDirection: 'row',
		alignItems: 'center',
		marginVertical: 16,
	},
	dividerLine: {
		flex: 1,
		height: 1,
		backgroundColor: '#D0D0D0',
	},
	orText: {
		marginHorizontal: 10,
		color: '#757575',
		fontSize: 13,
		fontWeight: '600',
	},
	customInput: {
		height: 100,
		borderWidth: 1,
		borderColor: '#E0E0E0',
		borderRadius: 8,
		backgroundColor: '#FFFFFF',
		paddingHorizontal: 12,
		paddingVertical: 10,
		fontSize: 15,
		color: '#212121',
	},
	charCounter: {
		marginTop: 6,
		marginBottom: 8,
		textAlign: 'right',
		color: '#757575',
		fontSize: 12,
	},
	locationInput: {
		borderWidth: 1,
		borderColor: '#E0E0E0',
		borderRadius: 8,
		backgroundColor: '#FFFFFF',
		paddingHorizontal: 12,
		paddingVertical: 10,
		fontSize: 15,
		color: '#212121',
	},
	locationHintText: {
		marginTop: 8,
		color: '#757575',
		fontSize: 12,
		marginBottom: 10,
	},
	sendButton: {
		margin: 20,
		marginTop: 24,
		height: 70,
		borderRadius: 12,
		backgroundColor: '#C62828',
		justifyContent: 'center',
		alignItems: 'center',
	},
	sendButtonDisabled: {
		opacity: 0.5,
	},
	sendButtonTitle: {
		color: '#FFFFFF',
		fontSize: 20,
		fontWeight: '800',
		lineHeight: 24,
	},
	sendButtonSubtitle: {
		color: '#FFCDD2',
		fontSize: 13,
		marginTop: 4,
		fontWeight: '600',
	},
})

export default SosScreen
